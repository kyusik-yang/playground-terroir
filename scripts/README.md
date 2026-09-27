# Scripts

Data-building scripts for the terroir atlas. Run them in order from the repository root with the project virtual environment.

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

Raw downloads go to `data/raw/` and intermediate files to `data/work/`. Both folders are gitignored. Everything the website reads is written to `docs/data/`.

| Step | Script | Reads | Writes |
|---|---|---|---|
| 1 | `01_inao.py` | INAO parcel delimitation shapefile | `data/work/terroir_l93.gpkg` |
| 2 | `02_terrain.py` | the GeoPackage, IGN RGE ALTI (downloaded) | `data/work/terrain_stats.csv`, `data/raw/dem/*.npy` |
| 3 | `03_export.py` | steps 1 and 2, commune names | `docs/data/terroir-*.geojson`, `docs/data/index.json` |
| 4 | `04_climate.py` | Open-Meteo (downloaded) | `docs/data/climate.json` |
| 5 | `05_transects.py` | steps 1 and 2 | `docs/data/transects.json` |
| 6 | `06_villages.py` | `content/villages.json`, `content/scope.json`, steps 1 to 3 | `docs/data/villages.json` and the `white` flags |
| 7 | `07_hero_art.py` | steps 1 and 2 | `docs/assets/hero-*.svg` |

## 1. Appellation geometry

Download the INAO dataset "Délimitation Parcellaire des AOC Viticoles de l'INAO" from data.gouv.fr (Licence Ouverte) and unzip it into `data/raw/inao/`:

```bash
mkdir -p data/raw/inao
curl -L -o data/raw/delim.zip "https://static.data.gouv.fr/resources/delimitation-parcellaire-des-aoc-viticoles-de-linao/20260921-213954/2026-09-21-delim-parcellaire-aoc-shp.zip"
unzip data/raw/delim.zip -d data/raw/inao
```

Each shapefile row is one appellation or one "dénomination géographique complémentaire" (a named premier cru or grand cru climat) within one commune, already dissolved from cadastral parcels. `01_inao.py` keeps the Côte-d'Or, Saône-et-Loire and Yonne rows of the Dijon and Mâcon INAO offices, restricted to the appellations listed in `REGIONS`, and dissolves them across communes into five layers. These are village appellations, the generic premier cru area of each appellation, named premier cru climats, grand crus (the Côte de Beaune grand cru AOCs and the seven Chablis Grand Cru climats), and the regional Bourgogne area of the same communes. Areas are measured in Lambert-93 (EPSG:2154).

INAO notes that the published data is informative and that the official delimitations are the plans filed in town halls and with INAO. Not every climat has been digitised by name yet. In Chablis only ten premier cru climats are named, all outside the commune of Chablis itself.

## 2. Terrain

`02_terrain.py` downloads the IGN RGE ALTI elevation model from the Géoplateforme WMS-Raster service (layer `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`) as raw 32-bit floats in Lambert-93 at 5 m, in 2,000-pixel tiles, one grid per region. For every polygon it takes the cells whose centres fall inside and reports elevation (minimum, 5th percentile, mean, 95th percentile, maximum), mean and median slope, and aspect. Aspect is the compass bearing of the downslope direction. Its mean is a circular mean weighted by the sine of the slope, over cells steeper than 2 degrees. The 8-sector histogram gives the share of that sloping ground facing N, NE, E, SE, S, SW, W and NW.

## 3. Web export

Step 3 names communes from the geo.api.gouv.fr commune lists of the three départements. No script downloads them, and without them the commune fields hold INSEE codes instead of names. Fetch them once from the repository root:

```bash
mkdir -p data/raw/geoapi
for d in 21 71 89; do
  curl -s "https://geo.api.gouv.fr/departements/$d/communes?fields=nom,code,centre,codesPostaux" -o data/raw/geoapi/communes_$d.json
done
```

`03_export.py` simplifies geometry for display only (4 m for appellations, 1.5 m for climats, 1 m for grand crus), reprojects to WGS84 with five decimals and writes one GeoJSON per region plus a light overview file. Statistics always come from the full-resolution geometry. Display rules follow the nesting of the appellations. The Petit Chablis shape shows only the land entitled to Petit Chablis but not to Chablis. Charlemagne, which lies entirely inside Corton-Charlemagne, is not drawn. Small features are painted over large ones.

## 4. Climate

`04_climate.py` builds `docs/data/climate.json`, a yearly climate record for one reference point in each of the four white-Burgundy sub-regions from 1950 to 2025.

Run it from the repository root:

```bash
.venv/bin/python scripts/04_climate.py
```

The first run downloads about 6 MB and takes a few minutes, because it waits 2 seconds between requests and backs off when Open-Meteo answers with HTTP 429. Raw responses are cached in `data/raw/openmeteo/`, which is not committed. Later runs read the cache, make no network calls and write a byte-identical file. Delete a cache file to download it again.

### Sources

- Weather data comes from the Open-Meteo Historical Weather API (https://open-meteo.com/en/docs/historical-weather-api).
- Temperature uses the ERA5-Land reanalysis (`models=era5_land`, 0.1 degree grid, about 11 km, from 1950).
- Precipitation uses the ERA5 reanalysis (`models=era5`, 0.25 degree grid, about 25 km). Open-Meteo returned no ERA5-Land precipitation values when this was built. On every run the script counts the non-null ERA5-Land precipitation values in the downloaded or cached response and stores the count in `meta.era5_land_precip_nonnull_values`. Delete the cache to check against a fresh download.
- Daily values are aggregated in the Europe/Paris time zone.
- The four points are commune centres from geo.api.gouv.fr. They are Chablis (Yonne, 89), Meursault (Côte-d'Or, 21), Rully (Saône-et-Loire, 71) and Fuissé (Saône-et-Loire, 71).
- Open-Meteo data are licensed CC BY 4.0. Any page that shows these numbers must link to Open-Meteo, for example with `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`. The exact wording is stored in `meta.licence_quote`.

### Index definitions

| Index | Period | Definition |
|---|---|---|
| `gs_tmean` | 1 Apr to 31 Oct | Mean of the daily mean temperature, in °C |
| `gdd10` | 1 Apr to 31 Oct | Winkler degree days. Sum of max(0, (Tmax + Tmin) / 2 - 10) |
| `huglin` | 1 Apr to 30 Sep | Huglin index. K times the sum of max(0, ((Tmean - 10) + (Tmax - 10)) / 2), with K = 1.05 |
| `spring_frost_days` | 1 Apr to 15 May | Days with Tmin below 0 °C |
| `spring_min_tmin` | 1 Apr to 15 May | Lowest daily Tmin, in °C |
| `hot_days` | 1 Jun to 31 Aug | Days with Tmax at or above 30 °C |
| `gs_precip` | 1 Apr to 31 Oct | Precipitation total, in mm |
| `sep_precip` | 1 Sep to 30 Sep | Precipitation total, in mm |

The Huglin day-length coefficient K comes from Table 2 of the ECA&D Algorithm Theoretical Basis Document (KNMI, version 11, 9 December 2021, page 31). That table gives 1.05 for 46°N to 48°N, and all four sites fall in that band. The script stops if a site ever falls in a different band.

For each site and index the `summary` block gives the 1961 to 1990 mean, the 2016 to 2025 mean, their difference, the least-squares trend per decade over 1950 to 2025, and the three highest and three lowest years. The difference is taken between the rounded means, so the three numbers agree when shown together.

The `analogs` block answers one question for each site. Which 10-year window of each other site had a mean `gs_tmean` closest to this site's 2016 to 2025 mean? Windows slide by one year from 1950-1959 to 2016-2025. There is one best window per other site, sorted by absolute difference. The `in_range` flag is false when the target lies outside every window mean of that site. In that case the listed window is only the nearest edge and not a real analog.

### Caveats

- Reanalysis grid cells average tens of square kilometres. An ERA5-Land cell is about 11 km north to south and 7.5 km east to west at this latitude. Cells smooth out vineyard microclimates, and frost pockets most of all.
- Each point is a village centre, not a vineyard. Slope, aspect and height within a commune can move temperatures up or down.
- Open-Meteo adjusts temperatures to the height of a 90 m elevation model at the requested point. That height is stored as `grid_elevation`.
- Reanalysis values are model estimates constrained by observations. They are not station measurements.
- Huglin daily terms below zero are set to zero here. The ECA&D formula does not show that floor. With the floor the index is about 18 to 25 points higher on average at these sites.
- A grid-cell daily minimum can miss the cold air that pools in hollows on clear spring nights. Frost counts here describe the broad pattern and cannot stand in for damage at a given plot.
- ERA5-Land starts at 00:00 UTC on 1 January 1950, so the first local day has no daily mean. That day is outside every index period and is ignored.

## 5. Cross-sections

`05_transects.py` draws five straight lines, either through two anchor features or through one anchor along its own mean downslope bearing, and extends them beyond the anchors. It samples the 5 m elevation model every 10 m with bilinear interpolation and tags each sample with the highest classification whose INAO polygon contains it (grand cru, premier cru, village, regional Bourgogne, or none).

## 6. Village profiles

`06_villages.py` merges the curated text in `content/villages.json` with computed statistics. Levels are made exclusive. Grand cru land is counted by commune, premier cru land excludes grand cru land, and village land is the rest of the village appellation area. Map markers follow the `MARKER` table in the script. Most are village centres from OpenStreetMap Nominatim (cached in `data/raw/nominatim.json`, one request per second), including Montagny, Pouilly-Fuissé and Saint-Véran, which span several communes. Petit Chablis, Corton-Charlemagne and Viré-Clessé use the representative point of the delimited area instead. If `content/scope.json` exists, it also writes the verified `white` flag (appellation allows white wine) into the map layers and the search index.

## 7. Hero artwork

`07_hero_art.py` contours the elevation model around the Montrachet grand crus every 5 m and writes three SVGs (contours, premier cru outlines, grand cru outlines). The page uses them as CSS masks, so their colours follow the theme.

