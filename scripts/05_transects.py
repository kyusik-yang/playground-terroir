"""Slope cross-sections: elevation profiles tagged with the appellation level of the land underneath.

Input : data/work/terroir_l93.gpkg, data/raw/dem/<region>.npy (+ .json), both from 01/02
Output: docs/data/transects.json

Each transect is a straight line through two anchor features (upslope anchor first), extended at both ends.
Samples every STEP metres, elevation by bilinear interpolation of the 5 m IGN RGE ALTI grid, and each sample
is tagged with the highest classification whose INAO polygon contains it:
grand cru > premier cru (named climat, else unnamed premier cru land) > village appellation > regional Bourgogne > none.
"""
from pathlib import Path
import json
import math

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data/work/terroir_l93.gpkg"
DEM_DIR = ROOT / "data/raw/dem"
OUT = ROOT / "docs/data/transects.json"
STEP = 10.0

# Two modes.
#   ("pair", upslope anchor, downslope anchor): line through both representative points.
#   ("bearing", anchor, downslope bearing in degrees or None to use the anchor's own mean aspect).
# Anchors are (layer, name, app). Extensions are metres beyond the anchors (up, down).
TRANSECTS = [
    ("montrachet", "Puligny and Chassagne through the Montrachets", "cote-de-beaune",
     ("pair", ("grand_cru", "Chevalier-Montrachet", None), ("grand_cru", "Bâtard-Montrachet", None)), 900, 1300),
    ("meursault", "Meursault, from Perrières down through Charmes", "cote-de-beaune",
     ("pair", ("climat", "Perrières", "Meursault"), ("climat", "Charmes", "Meursault")), 900, 1100),
    ("corton", "Over the hill of Corton, from En Charlemagne to the Corton slope", "cote-de-beaune",
     ("pair", ("grand_cru", "Charlemagne", None), ("grand_cru", "Corton", None)), 700, 900),
    ("chablis", "Chablis Grand Cru, Les Clos down to the Serein", "chablis",
     ("bearing", ("grand_cru", "Les Clos", "Chablis Grand Cru"), None), 900, 1000),
    ("fuisse", "Pouilly-Fuissé, under the Roche de Vergisson", "maconnais",
     ("bearing", ("climat", "Sur la Roche", "Pouilly-Fuissé"), None), 500, 1500),
]
RANK = {"grand-cru": 4, "premier-cru": 3, "village": 2, "regional": 1, "none": 0}


def load_dem(region):
    meta = json.loads((DEM_DIR / f"{region}.json").read_text())
    return np.load(DEM_DIR / f"{region}.npy"), meta


def bilinear(grid, meta, x, y):
    res = meta["res"]
    fx = (x - meta["x0"]) / res - 0.5
    fy = (meta["y1"] - y) / res - 0.5
    j, i = int(math.floor(fx)), int(math.floor(fy))
    dx, dy = fx - j, fy - i
    q = grid[i:i + 2, j:j + 2]
    return float(q[0, 0] * (1 - dx) * (1 - dy) + q[0, 1] * dx * (1 - dy) + q[1, 0] * (1 - dx) * dy + q[1, 1] * dx * dy)


def anchor_point(layers, spec):
    layer, name, app = spec
    g = layers[layer]
    sel = g
    if name is not None:
        sel = sel[sel["name"] == name]
    if app is not None:
        sel = sel[sel["app"] == app]
    assert len(sel) == 1, (spec, len(sel))
    return sel.geometry.iloc[0].representative_point()


def main():
    layers = {k: gpd.read_file(GPKG, layer=k) for k in ["appellation", "pc_area", "climat", "grand_cru", "regional"]}
    anchors_gc = layers["grand_cru"]
    layers["grand_cru"] = layers["grand_cru"][layers["grand_cru"]["app"] != "Charlemagne"]
    stats = __import__("pandas").read_csv(ROOT / "data/work/terrain_stats.csv").set_index("id")
    out = []
    for tid, title, region, spec, ext_up, ext_down in TRANSECTS:
        grid, meta = load_dem(region)
        look = dict(layers, grand_cru=anchors_gc)
        if spec[0] == "pair":
            up, down = spec[1], spec[2]
            a, b = anchor_point(look, up), anchor_point(look, down)
            vx, vy = b.x - a.x, b.y - a.y
            n = math.hypot(vx, vy)
            ux, uy = vx / n, vy / n
        else:
            up = down = spec[1]
            a = b = anchor_point(look, up)
            brg = spec[2]
            if brg is None:
                g = look[up[0]]
                row = g[(g["name"] == up[1]) & ((g["app"] == up[2]) if up[2] else True)]
                brg = float(stats.loc[row["id"].iloc[0], "aspect_deg"])
            ux, uy = math.sin(math.radians(brg)), math.cos(math.radians(brg))
        start = Point(a.x - ux * ext_up, a.y - uy * ext_up)
        end = Point(b.x + ux * ext_down, b.y + uy * ext_down)
        line = LineString([start, end])
        length = line.length
        ds = np.arange(0, length + 1e-6, STEP)
        pts = [line.interpolate(d) for d in ds]
        xs, ys = np.array([p.x for p in pts]), np.array([p.y for p in pts])
        z = np.array([bilinear(grid, meta, x, y) for x, y in zip(xs, ys)])

        level = np.array(["none"] * len(ds), dtype=object)
        name = np.array([""] * len(ds), dtype=object)
        fid = np.array([""] * len(ds), dtype=object)
        # paint lowest rank first so higher ranks overwrite; within a rank, larger polygons first
        order = [("regional", "regional"), ("appellation", "village"), ("pc_area", "premier-cru"),
                 ("climat", "premier-cru"), ("grand_cru", "grand-cru")]
        for layer, lev in order:
            g = layers[layer]
            g = g[g.intersects(line.buffer(1))].sort_values("area_ha", ascending=False)
            for _, f in g.iterrows():
                inside = shapely.contains_xy(f.geometry, xs, ys)
                if not inside.any():
                    continue
                label = f["app"] if layer in ("appellation", "regional") else f["name"]
                if layer == "pc_area":
                    label = f"{f['app']} premier cru"
                if layer == "climat":
                    label = f"{f['app']} premier cru {f['name']}"
                level[inside] = lev
                name[inside] = label
                fid[inside] = f["id"] if layer != "pc_area" else ""

        # merge runs into segments
        segs = []
        k0 = 0
        for k in range(1, len(ds) + 1):
            if k == len(ds) or level[k] != level[k0] or name[k] != name[k0]:
                seg_z = z[k0:k]
                segs.append({"from": round(float(ds[k0]), 1), "to": round(float(ds[k - 1]), 1),
                             "level": level[k0], "name": name[k0], "feature": fid[k0],
                             "z": [round(float(seg_z.min()), 1), round(float(seg_z.max()), 1)]})
                k0 = k
        ll = gpd.GeoSeries([start, end, a, b], crs=2154).to_crs(4326)
        bearing = (math.degrees(math.atan2(ux, uy)) + 360) % 360
        out.append({
            "id": tid, "title": title, "region": region,
            "anchors": [up[1] or up[2], down[1] or down[2]],
            "start": [round(ll.iloc[0].y, 5), round(ll.iloc[0].x, 5)],
            "end": [round(ll.iloc[1].y, 5), round(ll.iloc[1].x, 5)],
            "anchor_points": [[round(ll.iloc[2].y, 5), round(ll.iloc[2].x, 5)], [round(ll.iloc[3].y, 5), round(ll.iloc[3].x, 5)]],
            "bearing_downslope": round(bearing, 0), "length_m": round(length, 0), "step_m": STEP,
            "z": [round(float(v), 1) for v in z],
            "segments": segs,
            "z_range": [round(float(z.min()), 1), round(float(z.max()), 1)],
        })
        summary = ", ".join(f"{s['name'] or s['level']} {s['z'][0]:.0f}-{s['z'][1]:.0f}m" for s in segs if s["to"] - s["from"] >= 40)
        print(f"{tid}: {length:.0f} m, z {z.min():.0f}-{z.max():.0f} | {summary}")
    meta = {"dem": "IGN RGE ALTI 5 m via data.geopf.fr/wms-r (ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES)",
            "classification": "INAO Délimitation Parcellaire des AOC Viticoles (data.gouv.fr)",
            "method": "straight line through two anchor features, sampled every 10 m, bilinear elevation, highest containing classification"}
    OUT.write_text(json.dumps({"meta": meta, "transects": out}, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} {OUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
