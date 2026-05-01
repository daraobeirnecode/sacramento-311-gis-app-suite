# Sacramento 311 GIS App Suite

A small portfolio suite comparing different GIS client stacks against the same public Sacramento 311 service request data.

## Apps

| App | Path | Stack |
| --- | --- | --- |
| ArcGIS Maps SDK | `sacramento-311-map-app` | Vite + ArcGIS Maps SDK for JavaScript |
| MapLibre | `sacramento-311-maplibre-app` | Vite + MapLibre GL JS + OpenFreeMap/OpenStreetMap/OpenMapTiles |
| Leaflet | `sacramento-311-leaflet-app` | Vite + Leaflet + Leaflet.markercluster + OpenStreetMap |
| Homeless Response Dashboard | `sacramento-homeless-response-dashboard` | Vite + MapLibre GL JS + public Sacramento 311 ArcGIS REST |

## Data source

All apps consume the public Sacramento 311 FeatureServer layer:

```text
https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0
```

The open-source apps use open-source client stacks while still consuming public ArcGIS REST data.

## Local development

Run an app from its subdirectory:

```bash
cd sacramento-311-leaflet-app
npm install
npm run dev
```

Build an app:

```bash
npm run build
```

## Deployment

Each app is deployed separately on Vercel from its own project root.
