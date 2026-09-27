"""Merge curated village profiles with computed terroir statistics.

Input : content/villages.json (hand-edited), content/scope.json (verified white-wine scope, optional),
        data/work/terroir_l93.gpkg, INAO shapefile (per-commune grand cru rows), data/raw/dem/*.npy
Output: docs/data/villages.json, and the `white` flag patched into docs/data/terroir-*.geojson + index.json

Areas are delimited areas from INAO, not planted vineyard. Levels are made exclusive:
grand cru land in the village's communes, premier cru land outside it, then the rest of the village aire.
"""
from pathlib import Path
import importlib.util
import json
import time

import geopandas as gpd
import numpy as np
import pyogrio
import requests

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data/work/terroir_l93.gpkg"
SHP = next((ROOT / "data/raw/inao").glob("*_delim-parcellaire-aoc-shp.shp"))
CONTENT = ROOT / "content/villages.json"
SCOPE = ROOT / "content/scope.json"
NOMINATIM_CACHE = ROOT / "data/raw/nominatim.json"
OUT = ROOT / "docs/data/villages.json"

spec = importlib.util.spec_from_file_location("terrain", ROOT / "scripts/02_terrain.py")
terrain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)
exp_spec = importlib.util.spec_from_file_location("export", ROOT / "scripts/03_export.py")
export = importlib.util.module_from_spec(exp_spec)
exp_spec.loader.exec_module(export)

REGION_NAMES = export.REGION_NAMES
WHITE_GC_APPS = {"Montrachet", "Chevalier-Montrachet", "Bâtard-Montrachet", "Bienvenues-Bâtard-Montrachet",
                 "Criots-Bâtard-Montrachet", "Corton-Charlemagne", "Charlemagne", "Chablis Grand Cru"}
# How to place each map marker: ("nominatim", query) or ("aire", None) for the appellation's representative point
MARKER = {
    "chablis": ("nominatim", "Chablis, Yonne, France"),
    "petit-chablis": ("aire", None),
    "puligny-montrachet": ("nominatim", "Puligny-Montrachet, Côte-d'Or, France"),
    "chassagne-montrachet": ("nominatim", "Chassagne-Montrachet, Côte-d'Or, France"),
    "meursault": ("nominatim", "Meursault, Côte-d'Or, France"),
    "corton-charlemagne": ("aire", None),
    "saint-aubin": ("nominatim", "Saint-Aubin, Côte-d'Or, France"),
    "auxey-duresses": ("nominatim", "Auxey-Duresses, Côte-d'Or, France"),
    "pernand-vergelesses": ("nominatim", "Pernand-Vergelesses, Côte-d'Or, France"),
    "rully": ("nominatim", "Rully, Saône-et-Loire, France"),
    "montagny": ("nominatim", "Montagny-lès-Buxy, Saône-et-Loire, France"),
    "bouzeron": ("nominatim", "Bouzeron, Saône-et-Loire, France"),
    "pouilly-fuisse": ("nominatim", "Fuissé, Saône-et-Loire, France"),
    "saint-veran": ("nominatim", "Saint-Vérand, Saône-et-Loire, France"),
    "vire-clesse": ("aire", None),
}


def nominatim(q, cache):
    if q in cache:
        return cache[q]
    r = requests.get("https://nominatim.openstreetmap.org/search",
                     params={"q": q, "format": "jsonv2", "limit": 1},
                     headers={"User-Agent": "playground-terroir/2.0 (https://kyusik-yang.github.io/playground-terroir/)"},
                     timeout=30)
    r.raise_for_status()
    hit = r.json()[0]
    cache[q] = {"lat": round(float(hit["lat"]), 5), "lng": round(float(hit["lon"]), 5),
                "osm": f"{hit['osm_type']}/{hit['osm_id']}", "name": hit["name"]}
    time.sleep(1.1)  # Nominatim usage policy: max 1 request per second
    return cache[q]


def l93_to_ll(pt):
    p = gpd.GeoSeries([pt], crs=2154).to_crs(4326).iloc[0]
    return [round(p.y, 5), round(p.x, 5)]


def main():
    content = json.loads(CONTENT.read_text())
    scope = json.loads(SCOPE.read_text()) if SCOPE.exists() else {}
    white_apps = {a["app"]: a.get("white_allowed") for a in scope.get("appellations", [])}
    L = {k: gpd.read_file(GPKG, layer=k) for k in ["appellation", "pc_area", "climat", "grand_cru"]}
    aire = L["appellation"].set_index("app")
    pc = L["pc_area"].set_index("app")
    raw = pyogrio.read_dataframe(SHP)
    raw = raw[raw["dt"].isin(["Dijon", "Mâcon"]) & (raw["type_denom"] == "appellation")]
    gc_rows = raw[raw["app"].isin(WHITE_GC_APPS)]
    names = export.commune_names()

    dems = {}
    for region in REGION_NAMES:
        grid, x0, y1, res = terrain.load_dem(region, (0, 0, 0, 0)) if False else (None, None, None, None)
        m = json.loads((ROOT / f"data/raw/dem/{region}.json").read_text())
        g = np.load(ROOT / f"data/raw/dem/{region}.npy")
        s, a = terrain.slope_aspect(g, m["res"])
        dems[region] = (g, s, a, m["x0"], m["y1"], m["res"])

    def zs(geom, region):
        if geom is None or geom.is_empty or geom.area < 100:
            return None
        g, s, a, x0, y1, res = dems[region]
        st = terrain.zonal(geom, g, s, a, x0, y1, res)
        return None if st is None else {"elev": [st["elev_min"], st["elev_mean"], st["elev_max"]], "slope": st["slope_mean"],
                                        "aspect": st["aspect_deg"], "aspect_label": st["aspect_label"], "aspect_hist": st["aspect_hist"]}

    cache = json.loads(NOMINATIM_CACHE.read_text()) if NOMINATIM_CACHE.exists() else {}
    out = []
    for v in content["villages"]:
        vid, region = v["id"], v["region"]
        apps = export.PROFILED[vid]
        if vid == "corton-charlemagne":
            base = L["grand_cru"].set_index("app").loc["Corton-Charlemagne"].geometry
            codes = set()
            gc_geom = base
            pc_geom = None
            village_geom = None
            gc_list = [{"name": "Corton-Charlemagne", "area_ha": round(base.area / 1e4, 2),
                        "id": L["grand_cru"].set_index("app").loc["Corton-Charlemagne", "id"]}]
            app_ids = [L["grand_cru"].set_index("app").loc["Corton-Charlemagne", "id"]]
        else:
            main_app = apps[0]
            base = aire.loc[main_app].geometry
            if vid == "petit-chablis":
                base = base.difference(aire.loc["Chablis"].geometry)
            codes = set(aire.loc[main_app, "insee"].split(","))
            if vid == "chablis":
                codes = {"89068"}  # Chablis commune hosts all seven grand cru climats
            rows = gc_rows[gc_rows["insee"].isin(codes)]
            if vid == "petit-chablis":
                rows = rows.iloc[0:0]  # the exclusive Petit Chablis area holds no grand cru land
            gc_geom = rows.geometry.union_all() if len(rows) else None
            gc_list = []
            if vid == "chablis":
                for _, f in L["grand_cru"][L["grand_cru"]["app"] == "Chablis Grand Cru"].iterrows():
                    gc_list.append({"name": f["name"], "area_ha": round(f.geometry.area / 1e4, 2), "id": f["id"]})
            else:
                for app_name, grp in rows.groupby("app"):
                    if app_name == "Charlemagne":
                        continue
                    gc_list.append({"name": app_name, "area_ha": round(grp.geometry.union_all().area / 1e4, 2),
                                    "id": L["grand_cru"].set_index("app").loc[app_name, "id"]})
            pc_geom = pc.loc[main_app].geometry if main_app in pc.index else None
            if pc_geom is not None and gc_geom is not None:
                pc_geom = pc_geom.difference(gc_geom)
            village_geom = base
            for g in (pc_geom, gc_geom):
                if g is not None:
                    village_geom = village_geom.difference(g)
            app_ids = [aire.loc[a, "id"] for a in apps if a in aire.index]

        area = lambda g: 0.0 if g is None else round(g.area / 1e4, 1)
        # grand cru land is counted by commune, even where it falls outside the village aire polygon
        a_gc, a_pc, a_vl = area(gc_geom), area(pc_geom), area(village_geom)
        whole = base if gc_geom is None else base.union(gc_geom)
        n_climats = int((L["climat"]["app"] == apps[0]).sum()) if vid != "corton-charlemagne" else 0

        kind, q = MARKER[vid]
        if kind == "nominatim":
            hit = nominatim(q, cache)
            marker, msrc = [hit["lat"], hit["lng"]], f"OpenStreetMap Nominatim, {hit['osm']}"
        else:
            marker, msrc = l93_to_ll(base.representative_point()), "representative point of the INAO delimited area"

        climats = L["climat"][L["climat"]["app"] == apps[0]].sort_values("area_ha", ascending=False)
        prof = dict(v)
        prof.update({
            "regionName": REGION_NAMES[region],
            "apps": apps,
            "marker": marker, "markerSource": msrc,
            "communes": sorted({names.get(c, c) for c in codes}) if codes else ["Aloxe-Corton", "Ladoix-Serrigny", "Pernand-Vergelesses"],
            "stats": {
                "area_ha": {"grand_cru": a_gc, "premier_cru": a_pc, "village": a_vl, "total": area(whole)},
                "n_climats": n_climats,
                "grand_crus": gc_list,
                "all": zs(whole, region),
                "by_level": {"grand_cru": zs(gc_geom, region), "premier_cru": zs(pc_geom, region), "village": zs(village_geom, region)},
            },
            "featureIds": {"appellation": app_ids, "grand_crus": [g["id"] for g in gc_list if "id" in g],
                           "climats": list(climats["id"][:8])},
        })
        out.append(prof)
        print(f"{vid:22s} GC {a_gc:7.1f} ha  1er {a_pc:7.1f} ha  village {a_vl:8.1f} ha  climats {n_climats:3d}  marker {marker}")
    NOMINATIM_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()),
        "notes": [
            "Areas are INAO delimited areas in hectares, computed in Lambert-93 (EPSG:2154). Delimited land is not the same as planted vineyard.",
            "Levels are exclusive. Grand cru land is counted by commune. Premier cru land excludes grand cru land. Village land is the rest of the village appellation area.",
            "Elevation, slope and aspect come from the IGN RGE ALTI digital elevation model resampled to 5 m.",
        ],
        "villages": out,
    }
    def _bad(o):
        raise TypeError(f"{type(o)}: {str(o)[:300]}")
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=_bad))
    print(f"wrote {OUT} {OUT.stat().st_size / 1024:.1f} KB")

    # Patch the verified white-wine flag into map layers and the search index
    if white_apps:
        for region in REGION_NAMES:
            p = ROOT / f"docs/data/terroir-{region}.geojson"
            fc = json.loads(p.read_text())
            for f in fc["features"]:
                f["properties"]["white"] = white_apps.get(f["properties"]["app"])
            p.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
        idx_p = ROOT / "docs/data/index.json"
        idx = json.loads(idx_p.read_text())
        for f in idx["features"]:
            f["white"] = white_apps.get(f["app"])
        for r in idx["regions"]:  # file sizes after the white flags were written
            r["bytes"] = (ROOT / "docs" / r["file"]).stat().st_size
        idx_p.write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")))
        print("patched white flags for", sum(1 for x in white_apps.values() if x is not None), "appellations")


if __name__ == "__main__":
    main()
