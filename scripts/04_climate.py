#!/usr/bin/env python3
"""Build docs/data/climate.json for the white-Burgundy terroir atlas.

Data source: Open-Meteo Historical Weather API (reanalysis).
  - Temperature: ERA5-Land (0.1 deg, from 1950), models=era5_land.
  - Precipitation: ERA5 (0.25 deg, from 1940), models=era5. Open-Meteo returns
    null for every ERA5-Land precipitation value (checked 2026-09-25 for daily
    precipitation_sum, rain_sum and snowfall_sum), so
    precipitation comes from ERA5 instead. The script re-checks this on every
    run and records the count of non-null ERA5-Land values in the JSON meta.

Sites: commune centres from geo.api.gouv.fr (one per sub-region).

Idempotent. Raw API responses are cached under data/raw/openmeteo/ (gitignored)
and reused on later runs. Delete a cache file to force a re-download.

Usage:
    .venv/bin/python scripts/04_climate.py
"""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "openmeteo"
OUT_PATH = ROOT / "docs" / "data" / "climate.json"

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
GEO_URL = "https://geo.api.gouv.fr/communes"
DOCS_URL = "https://open-meteo.com/en/docs/historical-weather-api"
LICENCE_URL = "https://open-meteo.com/en/licence"

START_DATE = "1950-01-01"
END_DATE = "2025-12-31"
YEARS = list(range(1950, 2026))
TIMEZONE = "Europe/Paris"
SLEEP_S = 2.0
USER_AGENT = "playground-terroir/1.0 (https://kyusik-yang.github.io/playground-terroir/)"

TEMP_MODEL = "era5_land"
PRECIP_MODEL = "era5"
# precipitation_sum is also requested from ERA5-Land only to record that it is empty.
TEMP_VARS = ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum"]
PRECIP_VARS = ["precipitation_sum"]

SITES = [
    {"id": "chablis", "name": "Chablis", "dept": "89", "region": "Chablis"},
    {"id": "meursault", "name": "Meursault", "dept": "21", "region": "Côte de Beaune"},
    {"id": "rully", "name": "Rully", "dept": "71", "region": "Côte Chalonnaise"},
    {"id": "fuisse", "name": "Fuissé", "dept": "71", "region": "Mâconnais"},
]

BASELINE = (1961, 1990)
RECENT = (2016, 2025)
WINDOW = 10

# Huglin day-length coefficient K by latitude band (north), from the ECA&D ATBD
# Table 2 (Project team ECA&D, KNMI, version 11, 9 Dec 2021, p. 31).
# Bands are read as (lower, upper] in degrees N.
HUGLIN_K_TABLE = [(40.0, 1.00), (42.0, 1.02), (44.0, 1.03), (46.0, 1.04), (48.0, 1.05), (50.0, 1.06)]
HUGLIN_K_SOURCE = {
    "url": "https://knmi-ecad-assets-prd.s3.amazonaws.com/documents/atbd.pdf",
    "document": "European Climate Assessment & Dataset (ECA&D) Algorithm Theoretical Basis "
                "Document (ATBD), Project team ECA&D, KNMI, version 11, 9 December 2021, p. 31",
    "quote": "where K is a daylength coefficient. The daylight coefficient is a function of "
             "the latitude of the station but a clear definition is absent. The value of K "
             "is determined using table 2.",
    "table_row": "46°N-48°N 1.05",
    "accessed": "2026-09-25",
}

# Quotes checked on the live pages on 2026-09-25 (UTC).
LICENCE_QUOTE = ("API data are offered under Attribution 4.0 International (CC BY 4.0) ... "
                 "You must include a link next to any location Open-Meteo data are displayed, "
                 "for example: <a href=\"https://open-meteo.com/\">Weather data by Open-Meteo.com</a>")
RESOLUTION_QUOTE = ("ERA5 (0.25°, from 1940) and ERA5-Land (0.1°, from 1950); data set table: "
                    "ERA5-Land Global 0.1° (~11 km) Hourly 1950 to present")

# Index definitions. dp = rounding of yearly values, sdp = rounding of summary
# means, tdp = rounding of the per-decade trend.
INDICES = {
    "gs_tmean": {"label": "Growing-season mean temperature", "period": "1 Apr to 31 Oct",
                 "unit": "°C", "dp": 2, "sdp": 2, "tdp": 3,
                 "definition": "Mean of daily mean 2 m temperature"},
    "gdd10": {"label": "Growing degree days (Winkler)", "period": "1 Apr to 31 Oct",
              "unit": "°C·day", "dp": 0, "sdp": 0, "tdp": 1,
              "definition": "Sum of max(0, (Tmax + Tmin) / 2 - 10)"},
    "huglin": {"label": "Huglin heliothermal index", "period": "1 Apr to 30 Sep",
               "unit": "°C·day", "dp": 0, "sdp": 0, "tdp": 1,
               "definition": "K times the sum of max(0, ((Tmean - 10) + (Tmax - 10)) / 2), K = 1.05"},
    "spring_frost_days": {"label": "Spring frost days", "period": "1 Apr to 15 May",
                          "unit": "days", "dp": 0, "sdp": 1, "tdp": 2,
                          "definition": "Days with Tmin below 0 °C"},
    "spring_min_tmin": {"label": "Coldest spring night", "period": "1 Apr to 15 May",
                        "unit": "°C", "dp": 1, "sdp": 2, "tdp": 2,
                        "definition": "Lowest daily Tmin"},
    "hot_days": {"label": "Hot days", "period": "1 Jun to 31 Aug",
                 "unit": "days", "dp": 0, "sdp": 1, "tdp": 2,
                 "definition": "Days with Tmax at or above 30 °C"},
    "gs_precip": {"label": "Growing-season precipitation", "period": "1 Apr to 31 Oct",
                  "unit": "mm", "dp": 0, "sdp": 0, "tdp": 1,
                  "definition": "Precipitation sum (ERA5, 0.25°)"},
    "sep_precip": {"label": "September precipitation", "period": "1 Sep to 30 Sep",
                   "unit": "mm", "dp": 0, "sdp": 0, "tdp": 1,
                   "definition": "Precipitation sum (ERA5, 0.25°)"},
}

CAVEATS = [
    "Reanalysis grid cells average tens of square km (an ERA5-Land cell is about 11 by 7.5 km here) "
    "and smooth vineyard microclimates, especially frost pockets.",
    "Each site is the commune centre given by geo.api.gouv.fr, not a particular vineyard or climat. "
    "Slope, aspect and elevation inside a commune can shift temperatures in either direction.",
    "Temperature comes from ERA5-Land (0.1°, about 11 km per Open-Meteo). Open-Meteo adjusts it "
    "to the 90 m elevation model height of the requested point, which is the grid_elevation field.",
    "Precipitation comes from ERA5 (0.25°, about 25 km) because Open-Meteo returned no "
    "ERA5-Land precipitation values when this file was built.",
    "Reanalysis values are model estimates constrained by observations, not station measurements.",
    "Daily mean temperature is the mean of the hourly values in local time (Europe/Paris). "
    "Degree days use (Tmax + Tmin) / 2 as in the Winkler definition.",
    "Huglin daily terms below zero are set to zero here. The ECA&D formula does not show that floor, "
    "so values can differ slightly from implementations without it.",
    "Frost damage depends on bud stage and on air at vine height. A grid-cell daily minimum can miss "
    "the cold that settles in hollows on clear nights.",
]


# ---------------------------------------------------------------- network

def _get_json(url: str, params: dict, max_tries: int = 6) -> dict:
    """GET with retry and exponential backoff on 429 and 5xx."""
    delay = 5.0
    for attempt in range(1, max_tries + 1):
        r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=120)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            wait = float(r.headers.get("Retry-After", delay))
            print(f"  HTTP {r.status_code}, retry {attempt}/{max_tries} in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
            delay = min(delay * 2, 120)
            continue
        raise RuntimeError(f"HTTP {r.status_code} for {r.url}: {r.text[:300]}")
    raise RuntimeError(f"Gave up after {max_tries} tries: {url} {params}")


def cached_fetch(cache_path: Path, url: str, params: dict) -> dict:
    """Return the cached wrapper if present, otherwise fetch, cache and return it."""
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    accessed = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"  fetching {url} -> {cache_path.name}")
    data = _get_json(url, params)
    wrapper = {"url": url, "params": params, "accessed_utc": accessed, "response": data}
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(wrapper, ensure_ascii=False), encoding="utf-8")
    time.sleep(SLEEP_S)
    return wrapper


def resolve_commune(site: dict) -> dict:
    wrapper = cached_fetch(
        RAW_DIR / f"geo_commune_{site['id']}.json",
        GEO_URL,
        {"nom": site["name"], "fields": "nom,code,centre,codeDepartement"},
    )
    hits = [c for c in wrapper["response"]
            if c["nom"] == site["name"] and c["codeDepartement"] == site["dept"]]
    if len(hits) != 1:
        raise RuntimeError(f"Expected one commune for {site['name']} ({site['dept']}), got {hits}")
    lng, lat = hits[0]["centre"]["coordinates"]
    return {"insee": hits[0]["code"], "lat": lat, "lng": lng, "accessed": wrapper["accessed_utc"]}


def fetch_daily(site_id: str, lat: float, lng: float, model: str, variables: list[str]) -> dict:
    params = {
        "latitude": lat, "longitude": lng,
        "start_date": START_DATE, "end_date": END_DATE,
        "daily": ",".join(variables),
        "timezone": TIMEZONE,
        "models": model,
    }
    return cached_fetch(RAW_DIR / f"{site_id}_{model}_{START_DATE[:4]}-{END_DATE[:4]}.json",
                        ARCHIVE_URL, params)


# ---------------------------------------------------------------- indices

def huglin_k(lat: float) -> float:
    a = abs(lat)
    if a <= 40.0:
        return 1.00
    for upper, k in HUGLIN_K_TABLE[1:]:
        if a <= upper:
            return k
    raise ValueError(f"Latitude {lat} is outside the Huglin K table (40-50 deg)")


def _md(df: pd.DataFrame, m1: int, d1: int, m2: int, d2: int) -> pd.Series:
    """Boolean mask for month-day window [m1-d1, m2-d2] inclusive."""
    md = df["month"] * 100 + df["day"]
    return (md >= m1 * 100 + d1) & (md <= m2 * 100 + d2)


def yearly_indices(df: pd.DataFrame, k: float) -> pd.DataFrame:
    rows = []
    for year, g in df.groupby("year"):
        gs = g[_md(g, 4, 1, 10, 31)]
        hug = g[_md(g, 4, 1, 9, 30)]
        spring = g[_md(g, 4, 1, 5, 15)]
        summer = g[_md(g, 6, 1, 8, 31)]
        sep = g[_md(g, 9, 1, 9, 30)]
        assert len(gs) == 214 and len(hug) == 183 and len(spring) == 45
        assert len(summer) == 92 and len(sep) == 30
        gdd = np.maximum(0.0, (gs["tmax"] + gs["tmin"]) / 2.0 - 10.0).sum()
        hterm = np.maximum(0.0, ((hug["tmean"] - 10.0) + (hug["tmax"] - 10.0)) / 2.0).sum()
        rows.append({
            "year": year,
            "gs_tmean": gs["tmean"].mean(),
            "gdd10": gdd,
            "huglin": k * hterm,
            "huglin_nofloor": k * (((hug["tmean"] - 10.0) + (hug["tmax"] - 10.0)) / 2.0).sum(),
            "spring_frost_days": int((spring["tmin"] < 0.0).sum()),
            "spring_min_tmin": spring["tmin"].min(),
            "hot_days": int((summer["tmax"] >= 30.0).sum()),
            "gs_precip": gs["precip"].sum(),
            "sep_precip": sep["precip"].sum(),
        })
    return pd.DataFrame(rows).set_index("year")


def rnd(x: float, dp: int):
    """Round half away from zero, returning int when dp == 0."""
    q = 10 ** dp
    v = math.floor(abs(x) * q + 0.5) / q * (1 if x >= 0 else -1)
    if v == 0:
        v = 0.0  # avoid -0.0 in the JSON
    if dp == 0:
        return int(v)
    return round(v, dp)


def summarise(series: pd.Series, spec: dict) -> dict:
    years = series.index.to_numpy()
    vals = series.to_numpy(dtype=float)
    base = series.loc[BASELINE[0]:BASELINE[1]].mean()
    recent = series.loc[RECENT[0]:RECENT[1]].mean()
    slope = np.polyfit(years.astype(float), vals, 1)[0] * 10.0
    # Ties: larger value first for top, smaller first for bottom, then more recent year first.
    order_top = sorted(zip(years, vals), key=lambda t: (-t[1], -t[0]))[:3]
    order_bot = sorted(zip(years, vals), key=lambda t: (t[1], -t[0]))[:3]
    dp = spec["dp"]
    return {
        "baseline_1961_1990": rnd(base, spec["sdp"]),
        "recent_2016_2025": rnd(recent, spec["sdp"]),
        # Delta from the rounded means so the three numbers agree on the page.
        "delta": rnd(rnd(recent, spec["sdp"]) - rnd(base, spec["sdp"]), spec["sdp"]),
        "trend_per_decade": rnd(slope, spec["tdp"]),
        "top3": [[int(y), rnd(v, dp)] for y, v in order_top],
        "bottom3": [[int(y), rnd(v, dp)] for y, v in order_bot],
    }


def window_means(series: pd.Series) -> dict[tuple[int, int], float]:
    out = {}
    for start in range(YEARS[0], YEARS[-1] - WINDOW + 2):
        end = start + WINDOW - 1
        out[(start, end)] = float(series.loc[start:end].mean())
    return out


# ---------------------------------------------------------------- main

def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    site_records, yearly, accessed_all = [], {}, []
    era5land_precip_nonnull = 0

    for site in SITES:
        print(f"[{site['id']}]")
        com = resolve_commune(site)
        t_wrap = fetch_daily(site["id"], com["lat"], com["lng"], TEMP_MODEL, TEMP_VARS)
        p_wrap = fetch_daily(site["id"], com["lat"], com["lng"], PRECIP_MODEL, PRECIP_VARS)
        accessed_all += [t_wrap["accessed_utc"], p_wrap["accessed_utc"]]
        t, p = t_wrap["response"], p_wrap["response"]

        td, pdly = t["daily"], p["daily"]
        era5land_precip_nonnull += sum(v is not None for v in td["precipitation_sum"])
        if td["time"] != pdly["time"]:
            raise RuntimeError(f"Date axes differ between models for {site['id']}")
        df = pd.DataFrame({
            "date": pd.to_datetime(td["time"]),
            "tmax": td["temperature_2m_max"],
            "tmin": td["temperature_2m_min"],
            "tmean": td["temperature_2m_mean"],
            "precip": pdly["precipitation_sum"],
        })
        df["year"], df["month"], df["day"] = df["date"].dt.year, df["date"].dt.month, df["date"].dt.day
        # ERA5-Land starts at 1950-01-01 00:00 UTC, so the first local day lacks one
        # hour and its daily mean is null. Nulls are tolerated only outside the
        # 1 Apr to 31 Oct span that every index uses.
        used = _md(df, 4, 1, 10, 31)
        for col in ["tmax", "tmin", "tmean", "precip"]:
            n_in = int(df.loc[used, col].isna().sum())
            n_out = int(df.loc[~used, col].isna().sum())
            if n_in:
                raise RuntimeError(f"{site['id']}: {n_in} null values in {col} inside Apr-Oct")
            if n_out:
                dates = df.loc[~used & df[col].isna(), "date"].dt.strftime("%Y-%m-%d").tolist()
                print(f"  note: {n_out} null {col} outside Apr-Oct (unused): {dates[:5]}")

        k = huglin_k(com["lat"])
        yi = yearly_indices(df, k)
        assert list(yi.index) == YEARS, f"{site['id']}: years {yi.index.min()}-{yi.index.max()}"
        assert not yi.isna().any().any(), f"{site['id']}: NaN in yearly indices"
        yearly[site["id"]] = yi

        rec = {
            "id": site["id"], "name": site["name"], "region": site["region"],
            "insee": com["insee"],
            "lat": com["lat"], "lng": com["lng"],
            "grid_lat": round(t["latitude"], 4), "grid_lng": round(t["longitude"], 4),
            "grid_elevation": t["elevation"],
            "precip_grid_lat": round(p["latitude"], 4), "precip_grid_lng": round(p["longitude"], 4),
            "huglin_k": k,
            "years": YEARS,
        }
        for name, spec in INDICES.items():
            rec[name] = [rnd(v, spec["dp"]) for v in yi[name].tolist()]
        site_records.append(rec)

    ks = {r["huglin_k"] for r in site_records}
    if len(ks) != 1:
        raise RuntimeError(f"Sites fall in different Huglin K bands: {ks}")

    summary = {
        sid: {name: summarise(yi[name], spec) for name, spec in INDICES.items()}
        for sid, yi in yearly.items()
    }

    # Analogs. For each site, the closest 10-year window of each other site to
    # this site's 2016-2025 mean gs_tmean. One best window per other site,
    # sorted by absolute difference.
    wins = {sid: window_means(yi["gs_tmean"]) for sid, yi in yearly.items()}
    analogs = {}
    for sid, yi in yearly.items():
        target = float(yi["gs_tmean"].loc[RECENT[0]:RECENT[1]].mean())
        best = []
        for other in yearly:
            if other == sid:
                continue
            (w, m) = min(wins[other].items(), key=lambda kv: (abs(kv[1] - target), -kv[0][0]))
            vals = list(wins[other].values())
            best.append({"site": other, "window": [w[0], w[1]], "gs_tmean": rnd(m, 2),
                         "target": rnd(target, 2), "diff": rnd(m - target, 2),
                         "abs_diff": rnd(abs(m - target), 2),
                         # False when the target lies outside every window mean of
                         # that site, so the "analog" is only the nearest edge.
                         "in_range": bool(min(vals) <= target <= max(vals))})
        analogs[sid] = sorted(best, key=lambda d: d["abs_diff"])[:3]

    accessed = max(accessed_all)
    out = {
        "meta": {
            "source": "Open-Meteo Historical Weather API",
            "dataset": "ERA5-Land (temperature), ERA5 (precipitation)",
            "resolution": "ERA5-Land 0.1° (~11 km) for temperature, ERA5 0.25° (~25 km) for precipitation",
            "resolution_quote": RESOLUTION_QUOTE,
            "models": {"temperature": TEMP_MODEL, "precipitation": PRECIP_MODEL},
            "era5_land_precip_nonnull_values": era5land_precip_nonnull,
            "url": DOCS_URL,
            "api": ARCHIVE_URL,
            "licence": "CC BY 4.0",
            "licence_url": LICENCE_URL,
            "licence_quote": LICENCE_QUOTE,
            "attribution_html": '<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>',
            "citation": [
                "Zippenfenig, P. (2023). Open-Meteo.com Weather API [Computer software]. Zenodo. "
                "https://doi.org/10.5281/ZENODO.7970649",
                "Muñoz Sabater, J. (2019). ERA5-Land hourly data from 2001 to present [Data set]. ECMWF. "
                "https://doi.org/10.24381/CDS.E2161BAC",
                "Hersbach, H. et al. (2023). ERA5 hourly data on single levels from 1940 to present "
                "[Data set]. ECMWF. https://doi.org/10.24381/cds.adbb2d47",
            ],
            "accessed": accessed,
            "timezone": TIMEZONE,
            "years": [YEARS[0], YEARS[-1]],
            "baseline": list(BASELINE),
            "recent": list(RECENT),
            "huglin_k": ks.pop(),
            "huglin_k_source": HUGLIN_K_SOURCE,
            "sites_source": "https://geo.api.gouv.fr/communes (commune centre)",
            "caveats": CAVEATS,
        },
        "indices": {name: {k: v for k, v in spec.items() if k not in ("dp", "sdp", "tdp")}
                    for name, spec in INDICES.items()},
        "sites": site_records,
        "summary": summary,
        "analogs": analogs,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size:,} bytes)")

    # ------------------------------------------------------------ checks
    print("\nSanity checks")
    if era5land_precip_nonnull:
        print(f"  WARNING: ERA5-Land now returns {era5land_precip_nonnull} precipitation values. "
              "Revisit the choice of ERA5 for precipitation and the caveat text.")
    plaus = {"gs_tmean": (13, 19), "gdd10": (900, 2000)}
    for sid, yi in yearly.items():
        msgs = []
        for name, (lo, hi) in plaus.items():
            v = yi[name]
            bad = v[(v < lo) | (v > hi)]
            msgs.append(f"{name} {v.min():.1f}..{v.max():.1f}" + (f" OUT {list(bad.index)}" if len(bad) else ""))
        floor_gap = (yi["huglin"] - yi["huglin_nofloor"]).mean()
        msgs.append(f"huglin floor adds {floor_gap:.1f} on average")
        rank03 = int(yi["gs_tmean"].rank(ascending=False).loc[2003])
        msgs.append(f"2003 gs_tmean rank {rank03}/76, hot_days rank "
                    f"{int(yi['hot_days'].rank(ascending=False, method='min').loc[2003])}")
        msgs.append(f"spring_min_tmin 2016 {yi.loc[2016, 'spring_min_tmin']:.1f}, "
                    f"2021 {yi.loc[2021, 'spring_min_tmin']:.1f}; frost days 2016 "
                    f"{yi.loc[2016, 'spring_frost_days']}, 2021 {yi.loc[2021, 'spring_frost_days']}")
        print(f"  {sid}: " + " | ".join(msgs))

    # Reverse question. When did Meursault have the gs_tmean Chablis has now?
    target = float(yearly["chablis"]["gs_tmean"].loc[RECENT[0]:RECENT[1]].mean())
    close = [(w, m) for w, m in wins["meursault"].items() if abs(m - target) <= 0.10]
    first_above = next((w for w, m in wins["meursault"].items() if m >= target), None)
    print(f"\nChablis 2016-2025 gs_tmean {target:.2f}. Meursault windows within 0.10 °C: "
          + ", ".join(f"{w[0]}-{w[1]} ({m:.2f})" for w, m in close)
          + f". First Meursault window at or above it: {first_above}.")
    for sid in yearly:
        b = wins[sid][(BASELINE[0], BASELINE[0] + WINDOW - 1)]
        print(f"  {sid} window means: 1961-1970 {b:.2f}, 1981-1990 {wins[sid][(1981, 1990)]:.2f}, "
              f"1990-1999 {wins[sid][(1990, 1999)]:.2f}, 2000-2009 {wins[sid][(2000, 2009)]:.2f}, "
              f"2016-2025 {wins[sid][(2016, 2025)]:.2f}")


if __name__ == "__main__":
    main()
