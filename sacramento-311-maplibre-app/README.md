# Sacramento 311 Explorer — Open-source GIS stack

Open-source version of the Sacramento 311 mapping app.

## Stack

- Vite
- MapLibre GL JS
- OpenFreeMap vector basemap
- GeoJSON returned from ArcGIS REST
- Browser-side clustering via MapLibre
- Turf `bbox` for fitting to returned features

## Data source

Public City of Sacramento 311 FeatureServer:

`https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0`

The app requests bounded filtered GeoJSON from ArcGIS REST. It maps the latest 250 matching features for browser performance, while KPI/category stats query all matching records.

## Run locally

```bash
npm install
npm run dev
```

Open:

`http://127.0.0.1:5174/`

## Build

```bash
npm run build
```

Static output goes to `dist/`, suitable for GitHub/Vercel static deployment.

## Why this stack

MapLibre gives a polished open-source vector map UI with client-side clustering and styling. For a portfolio MVP, querying GeoJSON directly is simpler than prebuilding PMTiles. If this grew beyond a demo, the next step would be a scheduled ETL to PMTiles/FlatGeobuf/GeoParquet rather than live browser queries.
