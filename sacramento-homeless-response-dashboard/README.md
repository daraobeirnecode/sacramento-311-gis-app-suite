# Sacramento Homeless Response Dashboard

Operational GIS dashboard using public Sacramento 311 service request data to help triage homelessness/encampment-related reports.

## Purpose

This app is designed as a practical management view rather than a general 311 map. It helps a city team or analyst answer:

- Where are open homelessness/encampment-related reports concentrating?
- Which reports are new, aged, or likely to need follow-up?
- Which council districts carry the highest current workload?
- Which repeat hotspots should be reviewed first by outreach, cleanup, or enforcement coordination teams?

## Data source

Public City of Sacramento 311 ArcGIS FeatureServer:

```text
https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0
```

The app filters records where `CategoryLevel1` or `CategoryName` contains homeless/camp-related terms. It uses public read-only ArcGIS REST queries from a MapLibre client.

## Research findings from the data

Recent exploratory counts at build time showed:

```text
7 days:   3,324 homeless/camp reports, 1,903 open
30 days: 11,918 homeless/camp reports, 3,388 open
90 days: 36,236 homeless/camp reports, 4,062 open
365 days: 130,173 homeless/camp reports, 13,324 open
```

High-volume 90-day categories included:

- Homeless Camp - Primary
- Homeless Camp
- Homeless Camp-Trash
- Concern
- Camping - Tent or Structure
- Homeless Encampment Blocking Sidewalk
- Occupied Vehicle
- Private Property
- Park or Bike Trail
- Critical Infrastructure / Focus Area

Highest 90-day district workloads in the sampled query were District 4, District 2, District 6, District 5, and District 3.

## Features

- Default operational view: open/active homeless-related 311 reports from the last 30 days.
- Lenses for sidewalk/access, critical infrastructure, cleanup/trash, occupied vehicle, parks/trails, and private property.
- Full paged FeatureServer loading for the selected filter window.
- Clustered MapLibre map with priority symbology.
- Priority score based on status, age, and operational category.
- Repeat hotspot detection using a lightweight spatial grid.
- Manager brief generated from current live data.
- District workload ranking.
- Priority action queue with zoom-to-record behavior.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

This is a public-data demo. It does not expose individual vulnerability details beyond what exists in the public 311 service. It should be treated as an operational triage aid, not a case-management or outreach client-record system.
