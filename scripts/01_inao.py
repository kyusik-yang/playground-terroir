"""Extract white-Burgundy terroir geometry from the INAO parcel delimitation shapefile.

Input : data/raw/inao/*_delim-parcellaire-aoc-shp.shp  (INAO, Licence Ouverte, data.gouv.fr)
Output: data/work/terroir_l93.gpkg  (full-resolution geometry in Lambert-93, one layer per kind)

Kinds
  appellation : village-level AOC aire, dissolved across communes
  pc_area     : union of all premier cru parcels of an appellation (stats only, not drawn)
  climat      : named premier cru climat
  grand_cru   : grand cru (or Chablis Grand Cru climat)
  regional    : Bourgogne regional aire (used only to label transect samples)
"""
from pathlib import Path
import re
import unicodedata

import geopandas as gpd
import pandas as pd
import pyogrio

ROOT = Path(__file__).resolve().parents[1]
SHP = next((ROOT / "data/raw/inao").glob("*_delim-parcellaire-aoc-shp.shp"))
OUT = ROOT / "data/work/terroir_l93.gpkg"

REGIONS = {
    "chablis": ["Chablis", "Petit Chablis", "Chablis Grand Cru"],
    "cote-de-beaune": [
        "Ladoix", "Aloxe-Corton", "Pernand-Vergelesses", "Savigny-lès-Beaune", "Chorey-lès-Beaune",
        "Beaune", "Pommard", "Volnay", "Monthélie", "Auxey-Duresses", "Saint-Romain", "Meursault",
        "Blagny", "Puligny-Montrachet", "Chassagne-Montrachet", "Saint-Aubin", "Santenay", "Maranges",
        "Corton", "Corton-Charlemagne", "Charlemagne", "Montrachet", "Chevalier-Montrachet",
        "Bâtard-Montrachet", "Bienvenues-Bâtard-Montrachet", "Criots-Bâtard-Montrachet",
    ],
    "cote-chalonnaise": ["Bouzeron", "Rully", "Mercurey", "Givry", "Montagny"],
    "maconnais": ["Pouilly-Fuissé", "Pouilly-Loché", "Pouilly-Vinzelles", "Saint-Véran", "Viré-Clessé"],
}
GRAND_CRU_APPS = {
    "Corton", "Corton-Charlemagne", "Charlemagne", "Montrachet", "Chevalier-Montrachet",
    "Bâtard-Montrachet", "Bienvenues-Bâtard-Montrachet", "Criots-Bâtard-Montrachet",
}
APP_REGION = {a: r for r, apps in REGIONS.items() for a in apps}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def communes(series) -> list:
    return sorted({c.title() for c in series if c})


def dissolve(gdf: gpd.GeoDataFrame, key: str) -> gpd.GeoDataFrame:
    rows = []
    for k, g in gdf.groupby(key, sort=True):
        geom = g.geometry.union_all().buffer(0)
        rows.append({key: k, "app": g["app"].iloc[0], "communes": communes(g["nomcom"]),
                     "insee": ",".join(sorted(set(g["insee"]))), "geometry": geom})
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=gdf.crs)


def main():
    df = pyogrio.read_dataframe(SHP)
    df = df[df["dt"].isin(["Dijon", "Mâcon"]) & df["insee"].str[:2].isin(["21", "71", "89"])].copy()
    print("burgundy rows", len(df))

    scoped = df[df["app"].isin(APP_REGION)].copy()
    appl = scoped[scoped["type_denom"] == "appellation"]
    dgc = scoped[scoped["type_denom"] != "appellation"]

    layers = {}

    # Village-level appellations (grand cru apps go to their own layer)
    village = appl[~appl["app"].isin(GRAND_CRU_APPS | {"Chablis Grand Cru"})]
    a = dissolve(village, "denom")
    a["kind"] = "appellation"
    a["level"] = "village"
    a["name"] = a["denom"]
    layers["appellation"] = a

    # Generic premier cru union per appellation: denom == "<app> premier cru"
    pc_generic = dgc[dgc["denom"] == dgc["app"] + " premier cru"]
    p = dissolve(pc_generic, "denom")
    p["kind"] = "pc_area"
    p["level"] = "premier-cru"
    p["name"] = p["denom"]
    layers["pc_area"] = p

    # Named premier cru climats: "<app> premier cru <Climat>"
    is_named = [d.startswith(ap + " premier cru ") for d, ap in zip(dgc["denom"], dgc["app"])]
    named = dgc[is_named].copy()
    named = named[~named["app"].isin(GRAND_CRU_APPS)]
    c = dissolve(named, "denom")
    c["kind"] = "climat"
    c["level"] = "premier-cru"
    c["name"] = [d[len(ap) + len(" premier cru "):] for d, ap in zip(c["denom"], c["app"])]
    layers["climat"] = c

    # Grand crus: Côte de Beaune grand cru AOCs + the seven Chablis Grand Cru climats
    gc_cdb = appl[appl["app"].isin(GRAND_CRU_APPS)]
    g1 = dissolve(gc_cdb, "denom")
    g1["name"] = g1["denom"]
    chab = dgc[(dgc["app"] == "Chablis Grand Cru") & dgc["denom"].str.startswith("Chablis Grand Cru ")]
    g2 = dissolve(chab, "denom")
    g2["name"] = [d[len("Chablis Grand Cru "):] for d in g2["denom"]]
    g = pd.concat([g1, g2], ignore_index=True)
    g["kind"] = "grand_cru"
    g["level"] = "grand-cru"
    layers["grand_cru"] = gpd.GeoDataFrame(g, geometry="geometry", crs=df.crs)

    # Regional Bourgogne aire, restricted to communes that host a scoped appellation
    host = set(scoped["insee"])
    reg = df[(df["app"] == "Bourgogne") & (df["type_denom"] == "appellation") & df["insee"].isin(host)]
    r = dissolve(reg, "denom")
    r["kind"] = "regional"
    r["level"] = "regional"
    r["name"] = r["denom"]
    layers["regional"] = r

    if OUT.exists():
        OUT.unlink()
    for kind, gdf in layers.items():
        gdf = gdf.copy()
        gdf["region"] = [APP_REGION.get(ap, "") for ap in gdf["app"]]
        gdf["id"] = [slug(f"{kind}-{d}") for d in gdf["denom"]]
        gdf["communes"] = [", ".join(x) for x in gdf["communes"]]
        gdf["area_ha"] = (gdf.geometry.area / 1e4).round(2)
        cols = ["id", "kind", "level", "name", "denom", "app", "region", "communes", "insee", "area_ha", "geometry"]
        gdf[cols].to_file(OUT, layer=kind, driver="GPKG")
        print(f"{kind:12s} {len(gdf):4d} features, {gdf['area_ha'].sum():10.1f} ha")


if __name__ == "__main__":
    main()
