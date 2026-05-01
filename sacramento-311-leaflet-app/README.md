# Sacramento 311 Leaflet App

Standalone open-source GIS client for exploring public Sacramento 311 service requests.

## Stack

- Vite
- Leaflet 1.9
- Leaflet.markercluster
- OpenStreetMap raster tile basemap
- Public Sacramento 311 ArcGIS REST FeatureServer data

This is an **open-source client stack consuming public ArcGIS REST data**. The source data remains ArcGIS-hosted.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

If running beside the ArcGIS and MapLibre versions, use a fixed port:

```bash
npm run dev -- --port 5175
```

Then open:

```text
http://127.0.0.1:5175/
```

## Build

```bash
npm run build
```

## Data source

```text
https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0
```

The app queries aggregate counts separately from map display features. It renders the latest 250 matching mapped features to avoid overloading the browser.
