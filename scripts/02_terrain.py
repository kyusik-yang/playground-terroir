"""Terrain statistics (elevation, slope, aspect) for every appellation, premier cru and grand cru polygon.

DEM   : IGN RGE ALTI via the Géoplateforme WMS-Raster (layer ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES),
        requested as raw float32 BIL in Lambert-93 (EPSG:2154), cached under data/raw/dem/.
Input : data/work/terroir_l93.gpkg (from 01_inao.py)
Output: data/work/terrain_stats.csv (one row per feature id)
        data/raw/dem/<region>.npy + <region>.json (grid and georeference, reused by 05_transects.py)
"""
from pathlib import Path
import json
import math
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
import shapely

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data/work/terroir_l93.gpkg"
DEM_DIR = ROOT / "data/raw/dem"
OUT = ROOT / "data/work/terrain_stats.csv"

WMS = "https://data.geopf.fr/wms-r"
LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES"
RES = 5.0          # metres per cell
TILE = 2000        # pixels per request side
MIN_SLOPE_DEG = 2  # cells flatter than this carry no meaningful aspect
SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
LABELS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def fetch_tile(x0, y0, x1, y1, w, h):
    params = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": LAYER, "STYLES": "",
        "CRS": "EPSG:2154", "BBOX": f"{x0},{y0},{x1},{y1}", "WIDTH": w, "HEIGHT": h,
        "FORMAT": "image/x-bil;bits=32",
    }
    for attempt in range(5):
        r = requests.get(WMS, params=params, timeout=180)
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/x-bil"):
            a = np.frombuffer(r.content, dtype="<f4").reshape(h, w)
            return a
        time.sleep(2 ** attempt)
    raise RuntimeError(f"DEM tile failed {r.status_code} {r.text[:200]}")


def load_dem(region, bounds):
    """Return (grid, x0, y1, res). Row 0 is the northern edge. Cell (i, j) centre = (x0+(j+.5)res, y1-(i+.5)res)."""
    DEM_DIR.mkdir(parents=True, exist_ok=True)
    npy, meta = DEM_DIR / f"{region}.npy", DEM_DIR / f"{region}.json"
    x0, y0, x1, y1 = bounds
    x0, y0 = math.floor(x0 / RES) * RES, math.floor(y0 / RES) * RES
    x1, y1 = math.ceil(x1 / RES) * RES, math.ceil(y1 / RES) * RES
    W, H = int((x1 - x0) / RES), int((y1 - y0) / RES)
    if npy.exists() and meta.exists():
        m = json.loads(meta.read_text())
        if m["x0"] == x0 and m["y1"] == y1 and m["W"] == W and m["H"] == H:
            return np.load(npy), x0, y1, RES
    grid = np.empty((H, W), dtype="float32")
    for ti in range(0, H, TILE):
        for tj in range(0, W, TILE):
            h, w = min(TILE, H - ti), min(TILE, W - tj)
            tx0, ty1 = x0 + tj * RES, y1 - ti * RES
            grid[ti:ti + h, tj:tj + w] = fetch_tile(tx0, ty1 - h * RES, tx0 + w * RES, ty1, w, h)
            time.sleep(0.3)
    grid[grid < -1000] = np.nan  # nodata
    np.save(npy, grid)
    meta.write_text(json.dumps({"x0": x0, "y1": y1, "W": W, "H": H, "res": RES, "crs": "EPSG:2154",
                                "source": f"{WMS} {LAYER}", "fetched": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())}))
    return grid, x0, y1, RES


def slope_aspect(grid, res):
    # np.gradient along rows (southward) and columns (eastward)
    d_row, d_col = np.gradient(grid, res)
    dzdx, dzdy = d_col, -d_row                    # east and north components
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) + 360) % 360  # compass bearing of the downslope direction
    return slope, aspect


def zonal(geom, grid, slope, aspect, x0, y1, res):
    minx, miny, maxx, maxy = geom.bounds
    j0, j1 = max(0, int((minx - x0) / res)), min(grid.shape[1], int((maxx - x0) / res) + 1)
    i0, i1 = max(0, int((y1 - maxy) / res)), min(grid.shape[0], int((y1 - miny) / res) + 1)
    jj, ii = np.meshgrid(np.arange(j0, j1), np.arange(i0, i1))
    xs, ys = x0 + (jj + 0.5) * res, y1 - (ii + 0.5) * res
    inside = shapely.contains_xy(geom, xs, ys)
    if inside.sum() == 0:  # sliver smaller than a cell: sample its representative point
        p = geom.representative_point()
        ii = np.array([[int((y1 - p.y) / res)]]); jj = np.array([[int((p.x - x0) / res)]])
        inside = np.array([[True]])
    z = grid[ii[inside], jj[inside]]
    s = slope[ii[inside], jj[inside]]
    a = aspect[ii[inside], jj[inside]]
    ok = ~np.isnan(z)
    z, s, a = z[ok], s[ok], a[ok]
    if z.size == 0:
        return None
    steep = s >= MIN_SLOPE_DEG
    out = {
        "cells": int(z.size),
        "elev_min": round(float(z.min()), 1), "elev_p05": round(float(np.percentile(z, 5)), 1),
        "elev_mean": round(float(z.mean()), 1), "elev_p95": round(float(np.percentile(z, 95)), 1),
        "elev_max": round(float(z.max()), 1),
        "slope_mean": round(float(s.mean()), 1), "slope_median": round(float(np.median(s)), 1),
        "slope_pct_mean": round(float(np.tan(np.radians(s)).mean() * 100), 1),
    }
    if steep.sum() >= 3:
        rad = np.radians(a[steep])
        wgt = np.sin(np.radians(s[steep]))
        C, S = (wgt * np.cos(rad)).sum(), (wgt * np.sin(rad)).sum()
        mean = (math.degrees(math.atan2(S, C)) + 360) % 360
        R = math.hypot(C, S) / wgt.sum()
        hist = np.bincount(((a[steep] + 22.5) % 360 // 45).astype(int), minlength=8) / steep.sum()
        out.update({
            "aspect_deg": round(mean, 0), "aspect_label": LABELS16[int((mean + 11.25) % 360 // 22.5)],
            "aspect_R": round(R, 2), "aspect_hist": [round(float(h), 3) for h in hist],
            "flat_share": round(float(1 - steep.mean()), 3),
        })
    else:
        out.update({"aspect_deg": None, "aspect_label": "flat", "aspect_R": None,
                    "aspect_hist": [0] * 8, "flat_share": round(float(1 - steep.mean()), 3)})
    return out


def main():
    layers = {k: gpd.read_file(GPKG, layer=k) for k in ["appellation", "pc_area", "climat", "grand_cru"]}
    feats = pd.concat(layers.values(), ignore_index=True)
    rows = []
    for region, g in feats.groupby("region"):
        b = g.total_bounds
        pad = 800
        grid, x0, y1, res = load_dem(region, (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad))
        slope, aspect = slope_aspect(grid, res)
        print(f"{region}: DEM {grid.shape} at {res} m, elev {np.nanmin(grid):.0f}-{np.nanmax(grid):.0f} m")
        for _, f in g.iterrows():
            st = zonal(f.geometry, grid, slope, aspect, x0, y1, res)
            if st is None:
                print("  no data:", f["id"]); continue
            st["id"] = f["id"]
            st["aspect_hist"] = json.dumps(st["aspect_hist"])
            rows.append(st)
    df = pd.DataFrame(rows)
    df.to_csv(OUT, index=False)
    print(f"wrote {len(df)} rows to {OUT}")


if __name__ == "__main__":
    main()
