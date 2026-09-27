"""Hero artwork: real contour lines of the Puligny/Chassagne slope with grand cru and premier cru outlines.

Input : data/raw/dem/cote-de-beaune.npy (+ .json), data/work/terroir_l93.gpkg
Output: docs/assets/hero-contours.svg (contours), docs/assets/hero-crus.svg (grand cru outlines),
        docs/assets/hero-climats.svg (premier cru outlines). Used as CSS masks so colours follow the theme.
"""
from pathlib import Path
import json

import geopandas as gpd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import shapely
from shapely.geometry import LineString, box

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/assets"
INTERVAL = 5.0     # metres between contour lines
SIMPLIFY = 2.5     # metres
W_M, H_M = 5200, 3000  # frame in metres (landscape)


def main():
    meta = json.loads((ROOT / "data/raw/dem/cote-de-beaune.json").read_text())
    grid = np.load(ROOT / "data/raw/dem/cote-de-beaune.npy")
    gc = gpd.read_file(ROOT / "data/work/terroir_l93.gpkg", layer="grand_cru")
    cl = gpd.read_file(ROOT / "data/work/terroir_l93.gpkg", layer="climat")
    c = gc[gc["app"] == "Montrachet"].geometry.iloc[0].centroid
    x0, y0 = c.x - W_M * 0.52, c.y - H_M * 0.5
    frame = box(x0, y0, x0 + W_M, y0 + H_M)
    res = meta["res"]
    j0, j1 = int((x0 - meta["x0"]) / res), int((x0 + W_M - meta["x0"]) / res)
    i0, i1 = int((meta["y1"] - (y0 + H_M)) / res), int((meta["y1"] - y0) / res)
    sub = grid[i0:i1, j0:j1]
    xs = meta["x0"] + (np.arange(j0, j1) + 0.5) * res
    ys = meta["y1"] - (np.arange(i0, i1) + 0.5) * res
    levels = np.arange(np.floor(np.nanmin(sub) / INTERVAL) * INTERVAL, np.nanmax(sub), INTERVAL)
    cs = plt.contour(xs, ys, sub, levels=levels)

    def to_svg(x, y):
        return f"{x - x0:.1f},{(y0 + H_M) - y:.1f}"

    paths_thin, paths_bold = [], []
    for lev, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if len(seg) < 4:
                continue
            line = shapely.simplify(LineString(seg), SIMPLIFY)
            if line.length < 60:
                continue
            d = "M" + " L".join(to_svg(x, y) for x, y in line.coords)
            (paths_bold if int(round(lev)) % 25 == 0 else paths_thin).append(d)

    def poly_paths(gdf):
        out = []
        for g in gdf.geometry:
            g = g.intersection(frame)
            for p in getattr(g, "geoms", [g]):
                if p.is_empty or p.geom_type != "Polygon":
                    continue
                p = shapely.simplify(p, 1.5)
                out.append("M" + " L".join(to_svg(x, y) for x, y in p.exterior.coords) + " Z")
        return out

    gc_in = gc[gc.intersects(frame) & (gc["app"] != "Charlemagne")]
    cl_in = cl[cl.intersects(frame)]
    vb = f'viewBox="0 0 {W_M} {H_M}" preserveAspectRatio="xMidYMid slice"'
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hero-contours.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" {vb}>'
        f'<path fill="none" stroke="#000" stroke-width="2.2" d="{" ".join(paths_thin)}"/>'
        f'<path fill="none" stroke="#000" stroke-width="5" d="{" ".join(paths_bold)}"/></svg>')
    (OUT / "hero-crus.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" {vb}><path fill="#000" fill-opacity=".22" stroke="#000" stroke-width="6" '
        f'd="{" ".join(poly_paths(gc_in))}"/></svg>')
    (OUT / "hero-climats.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" {vb}><path fill="none" stroke="#000" stroke-width="3" stroke-dasharray="10 8" '
        f'd="{" ".join(poly_paths(cl_in))}"/></svg>')
    for f in ["hero-contours.svg", "hero-crus.svg", "hero-climats.svg"]:
        print(f, round((OUT / f).stat().st_size / 1024, 1), "KB")
    print("grand crus in frame:", sorted(gc_in["name"]))
    print("elevation range", round(float(np.nanmin(sub))), round(float(np.nanmax(sub))))


if __name__ == "__main__":
    main()
