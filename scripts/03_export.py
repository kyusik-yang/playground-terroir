"""Export web-ready terroir layers (GeoJSON per region) and a search index.

Input : data/work/terroir_l93.gpkg, data/work/terrain_stats.csv, data/raw/geoapi/communes_*.json
Output: docs/data/terroir-<region>.geojson, docs/data/index.json
Geometry is simplified for display only. All statistics come from the full-resolution geometry.
"""
from pathlib import Path
import glob
import json
import time

import geopandas as gpd
import pandas as pd
import shapely

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data/work/terroir_l93.gpkg"
STATS = ROOT / "data/work/terrain_stats.csv"
OUT = ROOT / "docs/data"

REGION_NAMES = {"chablis": "Chablis", "cote-de-beaune": "Côte de Beaune",
                "cote-chalonnaise": "Côte Chalonnaise", "maconnais": "Mâconnais"}
# profiled village id -> INAO appellation names that belong to its profile
PROFILED = {
    "chablis": ["Chablis", "Chablis Grand Cru"], "petit-chablis": ["Petit Chablis"],
    "puligny-montrachet": ["Puligny-Montrachet"], "chassagne-montrachet": ["Chassagne-Montrachet"],
    "meursault": ["Meursault"], "corton-charlemagne": ["Corton-Charlemagne"],
    "saint-aubin": ["Saint-Aubin"], "auxey-duresses": ["Auxey-Duresses"],
    "pernand-vergelesses": ["Pernand-Vergelesses"], "rully": ["Rully"], "montagny": ["Montagny"],
    "bouzeron": ["Bouzeron"], "pouilly-fuisse": ["Pouilly-Fuissé"], "saint-veran": ["Saint-Véran"],
    "vire-clesse": ["Viré-Clessé"],
}
APP_TO_VILLAGE = {a: v for v, apps in PROFILED.items() for a in apps}
TOLERANCE = {"appellation": 4.0, "climat": 1.5, "grand_cru": 1.0}
OVERVIEW_TOLERANCE = 40.0
# Charlemagne lies entirely inside Corton-Charlemagne and is not drawn separately.
HIDDEN = {"Charlemagne"}
# Draw Corton below Corton-Charlemagne (the latter lies inside the former).
GC_ORDER = {"Corton": 0}
MIN_PART_M2 = {"appellation": 800, "climat": 30, "grand_cru": 10}


def commune_names():
    names = {}
    for f in glob.glob(str(ROOT / "data/raw/geoapi/communes_*.json")):
        for c in json.load(open(f)):
            names[c["code"]] = c["nom"]
    return names


def clean(geom, kind):
    """Simplify for display, drop slivers and tiny holes."""
    g = shapely.simplify(geom, TOLERANCE[kind], preserve_topology=True)
    parts = [p for p in getattr(g, "geoms", [g]) if p.area >= MIN_PART_M2[kind]]
    if not parts:  # keep the largest part of tiny features
        parts = [max(getattr(g, "geoms", [g]), key=lambda p: p.area)]
    fixed = []
    for p in parts:
        holes = [h for h in p.interiors if shapely.Polygon(h).area >= MIN_PART_M2[kind]]
        fixed.append(shapely.Polygon(p.exterior, holes))
    return shapely.MultiPolygon(fixed) if len(fixed) > 1 else fixed[0]


def overview_shape(geom):
    """Zoomed-out display: close gaps between neighbouring parcels, simplify, drop slivers under 1 ha."""
    g = geom.buffer(60, join_style="round").buffer(-60, join_style="round")
    g = shapely.simplify(g, OVERVIEW_TOLERANCE, preserve_topology=True)
    parts = [p for p in getattr(g, "geoms", [g]) if p.area >= 1e4] or [max(getattr(g, "geoms", [g]), key=lambda p: p.area)]
    fixed = [shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 1e4]) for p in parts]
    return shapely.MultiPolygon(fixed) if len(fixed) > 1 else fixed[0]


def rnd(obj, nd=5):
    """Round every float in a nested GeoJSON-like structure (dicts, lists, tuples)."""
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, dict):
        return {k: rnd(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [rnd(o, nd) for o in obj]
    return obj


def main():
    names = commune_names()
    stats = pd.read_csv(STATS).set_index("id")
    layers = {k: gpd.read_file(GPKG, layer=k) for k in ["appellation", "climat", "grand_cru", "pc_area"]}
    pc = layers.pop("pc_area").set_index("app")
    n_climats = layers["climat"].groupby("app").size()

    # Display geometry for Petit Chablis = land entitled to Petit Chablis but not to Chablis.
    ap = layers["appellation"]
    chab = ap.loc[ap["app"] == "Chablis"].geometry.iloc[0]
    display_geom = {i: (g.difference(chab) if a == "Petit Chablis" else g)
                    for i, a, g in zip(ap["id"], ap["app"], ap.geometry)}
    layers["grand_cru"] = layers["grand_cru"][~layers["grand_cru"]["app"].isin(HIDDEN)]
    # Paint order: big under small, Corton under Corton-Charlemagne.
    for k in ["appellation", "climat"]:
        layers[k] = layers[k].sort_values("area_ha", ascending=False)
    gc = layers["grand_cru"]
    layers["grand_cru"] = gc.assign(_o=[GC_ORDER.get(a, 1) for a in gc["app"]]).sort_values(
        ["_o", "area_ha"], ascending=[True, False]).drop(columns="_o")
    overview = []

    index_feats, regions = [], []
    OUT.mkdir(parents=True, exist_ok=True)
    for region, rname in REGION_NAMES.items():
        feats = []
        for kind in ["appellation", "climat", "grand_cru"]:
            g = layers[kind][layers[kind]["region"] == region]
            for _, f in g.iterrows():
                s = stats.loc[f["id"]]
                src = display_geom.get(f["id"], f.geometry)
                geom_l93 = clean(src, kind)
                geom = gpd.GeoSeries([geom_l93], crs=2154).to_crs(4326).iloc[0]
                full_c = gpd.GeoSeries([f.geometry.representative_point()], crs=2154).to_crs(4326).iloc[0]
                bb = gpd.GeoSeries([f.geometry], crs=2154).to_crs(4326).total_bounds
                name = f["app"] if kind == "appellation" else f["name"]
                props = {
                    "id": f["id"], "kind": kind, "level": f["level"], "name": name, "full": f["denom"],
                    "app": f["app"], "region": region,
                    "communes": [names.get(c, c) for c in f["insee"].split(",")],
                    "area_ha": float(f["area_ha"]),
                    "elev": [float(s["elev_min"]), float(s["elev_mean"]), float(s["elev_max"])],
                    "slope": float(s["slope_mean"]), "slope_pct": float(s["slope_pct_mean"]),
                    "aspect": None if pd.isna(s["aspect_deg"]) else int(s["aspect_deg"]),
                    "aspect_label": s["aspect_label"],
                    "aspect_hist": json.loads(s["aspect_hist"]),
                    "village": APP_TO_VILLAGE.get(f["app"]),
                }
                if f["app"] == "Petit Chablis":
                    props["display_note"] = "petit-chablis-exclusive"
                if f["app"] == "Corton-Charlemagne":
                    props["contains"] = ["Charlemagne"]
                if kind in ("appellation", "grand_cru"):
                    ov = gpd.GeoSeries([overview_shape(src)], crs=2154).to_crs(4326).iloc[0]
                    overview.append({"type": "Feature", "properties": {k: props[k] for k in ("id", "kind", "level", "name", "region", "village")},
                                     "geometry": rnd(shapely.geometry.mapping(ov), 4)})
                if kind == "appellation":
                    props["pc_area_ha"] = float(pc.loc[f["app"], "area_ha"]) if f["app"] in pc.index else None
                    props["n_climats"] = int(n_climats.get(f["app"], 0))
                    props["white"] = None  # filled by 06_villages.py from the verified scope list
                feats.append({"type": "Feature", "properties": props,
                              "geometry": rnd(shapely.geometry.mapping(geom))})
                index_feats.append({
                    "id": f["id"], "kind": kind, "level": f["level"], "name": name, "full": f["denom"],
                    "app": f["app"], "region": region, "village": APP_TO_VILLAGE.get(f["app"]),
                    "center": [round(full_c.y, 5), round(full_c.x, 5)],
                    "bbox": [round(bb[1], 5), round(bb[0], 5), round(bb[3], 5), round(bb[2], 5)],
                    "area_ha": float(f["area_ha"]), "elev_mean": float(s["elev_mean"]),
                    "aspect_label": s["aspect_label"],
                })
        fc = {"type": "FeatureCollection", "features": feats}
        path = OUT / f"terroir-{region}.geojson"
        path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
        rb = [f for f in index_feats if f["region"] == region]
        regions.append({
            "id": region, "name": rname, "file": f"data/terroir-{region}.geojson",
            "bounds": [[min(f["bbox"][0] for f in rb), min(f["bbox"][1] for f in rb)],
                       [max(f["bbox"][2] for f in rb), max(f["bbox"][3] for f in rb)]],
            "counts": {k: sum(1 for f in feats if f["properties"]["kind"] == k) for k in TOLERANCE},
            "bytes": path.stat().st_size,
        })
        print(f"{region:18s} {len(feats):4d} features {path.stat().st_size / 1024:8.1f} KB")

    ov_path = OUT / "terroir-overview.geojson"
    ov_path.write_text(json.dumps({"type": "FeatureCollection", "features": overview}, ensure_ascii=False, separators=(",", ":")))
    print(f"overview {len(overview)} features {ov_path.stat().st_size / 1024:.1f} KB")
    index = {
        "generated": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()),
        "source": {
            "inao": {"title": "Délimitation Parcellaire des AOC Viticoles de l'INAO",
                     "url": "https://www.data.gouv.fr/datasets/delimitation-parcellaire-des-aoc-viticoles-de-linao",
                     "file": "2026-09-21-delim-parcellaire-aoc-shp.zip", "licence": "Licence Ouverte / Open Licence (Etalab)"},
            "dem": {"title": "IGN RGE ALTI (Géoplateforme WMS-Raster, ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES)",
                    "url": "https://data.geopf.fr/wms-r", "resolution_m": 5, "licence": "Licence Ouverte / Open Licence (Etalab)"},
        },
        "regions": regions,
        "features": index_feats,
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"index.json {(OUT / 'index.json').stat().st_size / 1024:.1f} KB, {len(index_feats)} features")


if __name__ == "__main__":
    main()
