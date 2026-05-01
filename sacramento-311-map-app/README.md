# Sacramento 311 Service Request Map

A standalone ArcGIS Maps SDK for JavaScript mapping application built with Vite and the CDN AMD `require` pattern.

## What it does

- Maps public Sacramento 311 service requests.
- Uses a bounded default 30-day window for performance.
- Supports filters for time window, category, and public status.
- Shows KPI counts, grouped category statistics, and latest matching requests.
- Uses clustering so the 1M+ record source layer is usable in the browser.

## Data source

City of Sacramento public 311 layer:

`https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0`

ArcGIS Online item discovered as **Sacramento 311 Calls View (Current)**, public owner `Applications_SacCity`.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL, normally:

`http://127.0.0.1:5173/`

## Build

```bash
npm run build
```

The static output is written to `dist/`.

## Notes

This app deliberately uses ArcGIS Maps SDK 4.34 from the CDN because Dara's portfolio convention is Vite + CDN AMD `require`, not npm/ESM ArcGIS SDK.
