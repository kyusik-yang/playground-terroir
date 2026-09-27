# Bourgogne Blanc - A Terroir Atlas

An interactive atlas of white Burgundy. Every appellation, premier cru climat and grand cru is drawn from INAO's digital parcel delimitation. Each one is measured on the IGN elevation model for height, slope and the direction it faces, and read against seventy-six years of climate reanalysis. Fifteen appellations get full profiles with tasting notes, producers and pairings, and a finder quiz matches you to one.

**Live:** [kyusik-yang.github.io/playground-terroir](https://kyusik-yang.github.io/playground-terroir/)

## What is in it

- **Plate I, the map.** 30 village appellations, 500 named premier cru climats and the white grand crus of Chablis and the Côte de Beaune, on IGN relief, aerial photography or the BRGM 1:50,000 geological map. Search any climat, click it for its area, elevation range, mean slope and aspect rose. Red-only appellations (Pommard, Volnay and Blagny) are marked.
- **Plate II, the slope.** Five cross-sections cut through the hillsides (the Montrachets, Meursault Perrières and Charmes, the hill of Corton, the Chablis grand cru slope, the Roche de Vergisson), sampled every 10 m and coloured by the appellation of the ground underneath, with a linked aerial locator map.
- **Plate III, the climate.** Growing-season temperature, Winkler degree days, the Huglin index, spring frost, hot days and rain at Chablis, Meursault, Rully and Fuissé, 1950 to 2025, with warming stripes, ten-year analogs and a year inspector.
- **Plate IV, the villages.** Exclusive grand cru, premier cru and village land per appellation, where that land sits in elevation, and fifteen profiles with a comparison tray.
- **Plate V, the finder.** Four questions, a transparent score for all fifteen appellations and a shareable result link.
- **Sources and method.** Every dataset with its licence and access date, and a plain-English account of how each number is computed.

## Data

| Source | Used for | Licence |
|---|---|---|
| INAO, Délimitation Parcellaire des AOC Viticoles (data.gouv.fr) | appellation and climat geometry | Licence Ouverte / Open Licence |
| IGN RGE ALTI via the Géoplateforme | elevation, slope, aspect, cross-sections, hero contours | Licence Ouverte / Open Licence 2.0 |
| IGN Géoplateforme WMTS | Plan IGN, high-resolution hillshade from RGE ALTI, contour lines, hydrography and buildings (BD TOPO), aerial photography | Licence Ouverte / Open Licence 2.0 |
| BRGM geological map 1:50,000 (WMS) | geology overlay | Licence Ouverte / Open Licence 2.0 |
| Open-Meteo Historical Weather API (ERA5-Land, ERA5) | climate indices | CC BY 4.0 |
| geo.api.gouv.fr, OpenStreetMap Nominatim | commune names, village marker positions | Licence Ouverte, ODbL |

The INAO delimitations are published for information only. The official delimitations are the plans filed in town halls and with INAO.
The appellation colour rules were checked against the INAO cahiers des charges, and the official Chablis climat count against the Bourgogne wine board (BIVB). The colour rules are recorded with their sources in `content/scope.json`, and every source with its licence and access date in `docs/data/sources.json`. Tasting notes, producers and pairings in the village profiles are editorial.

## Layout

```
docs/                 the website (GitHub Pages serves this folder)
  index.html
  css/                base.css (design tokens) + one stylesheet per module
  js/                 main.js, util.js, bus.js, data.js + one module per plate
  data/               generated JSON and GeoJSON (see docs/data/README.md)
  assets/             hero contour SVGs, favicon, social preview image
content/              hand-edited village profiles and the verified scope list
scripts/              the data pipeline, 01 to 07 (see scripts/README.md)
```

## Development

The site is static ES modules with no build step. Modules need to be served over HTTP:

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000
```

To rebuild the data, see [`scripts/README.md`](scripts/README.md). To change a village profile, edit `content/villages.json` and run `scripts/06_villages.py`.

## Tech

Leaflet 1.9.4 from jsDelivr, Google Fonts (Cormorant, Instrument Sans, IBM Plex Mono), vanilla JavaScript. The Python pipeline uses geopandas, shapely, pyogrio, numpy and matplotlib.

## Inspiration

*Big Macs & Burgundy* by Vanessa Price.
