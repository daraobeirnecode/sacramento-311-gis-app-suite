import maplibregl from 'maplibre-gl';
import bbox from '@turf/bbox';
import './style.css';

const SERVICE_URL = 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0';
const SACRAMENTO_CENTER = [-121.4944, 38.5816];
const PAGE_SIZE = 2000;
const CATEGORY_COLORS = {
  'Solid Waste': '#0ea5e9',
  'Homeless Camp - Primary': '#f97316',
  'Other': '#64748b',
  'Review': '#eab308',
  'Animal Control': '#22c55e',
  'Code Enforcement': '#ef4444',
  'Streets': '#a855f7'
};
const CATEGORY_COLOR_MATCH = ['match', ['get', 'CategoryLevel1'], ...Object.entries(CATEGORY_COLORS).flat(), '#334155'];

const elements = {
  daysSelect: document.getElementById('daysSelect'),
  categorySelect: document.getElementById('categorySelect'),
  statusSelect: document.getElementById('statusSelect'),
  refreshButton: document.getElementById('refreshButton'),
  totalCount: document.getElementById('totalCount'),
  openCount: document.getElementById('openCount'),
  closedCount: document.getElementById('closedCount'),
  categoryBars: document.getElementById('categoryBars'),
  latestList: document.getElementById('latestList'),
  windowLabel: document.getElementById('windowLabel'),
  mapStatus: document.getElementById('mapStatus')
};

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: SACRAMENTO_CENTER,
  zoom: 11.5,
  attributionControl: true
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function formatArcGisTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `timestamp '${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}'`;
}

function buildWhere() {
  const days = Number(elements.daysSelect.value || 7);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const clauses = [`DateCreated >= ${formatArcGisTimestamp(start)}`];

  if (elements.categorySelect.value) {
    clauses.push(`CategoryLevel1 = '${escapeSql(elements.categorySelect.value)}'`);
  }

  if (elements.statusSelect.value === 'CLOSED') {
    clauses.push("UPPER(PublicStatus) = 'CLOSED'");
  } else if (elements.statusSelect.value === 'OPEN') {
    clauses.push("UPPER(PublicStatus) <> 'CLOSED'");
  }

  elements.windowLabel.textContent = `${days} days`;
  return clauses.join(' AND ');
}

async function arcgisQuery(params) {
  const url = new URL(`${SERVICE_URL}/query`);
  url.searchParams.set('f', 'geojson');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`ArcGIS REST request failed: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'ArcGIS REST returned an error');
  return json;
}

async function arcgisJsonQuery(params) {
  const url = new URL(`${SERVICE_URL}/query`);
  url.searchParams.set('f', 'json');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`ArcGIS REST request failed: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'ArcGIS REST returned an error');
  return json;
}

async function countWhere(where) {
  const json = await arcgisJsonQuery({ where, returnCountOnly: true, returnGeometry: false });
  return Number(json.count || 0);
}

async function categoryStats(where) {
  const json = await arcgisJsonQuery({
    where,
    outFields: 'CategoryLevel1',
    groupByFieldsForStatistics: 'CategoryLevel1',
    outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'request_count' }]),
    orderByFields: 'request_count DESC',
    resultRecordCount: 6,
    returnGeometry: false
  });
  return (json.features || []).map((feature) => ({
    label: feature.attributes.CategoryLevel1 || 'Unknown',
    count: Number(feature.attributes.request_count || 0)
  }));
}

async function fetchAllFeatures(where, total) {
  const allFeatures = [];
  let offset = 0;

  while (offset < Math.max(total, 1)) {
    setStatus(`Loading full 7-day map layer… ${allFeatures.length.toLocaleString()} of ${total.toLocaleString()} records`);
    const page = await arcgisQuery({
      where,
      outFields: 'OBJECTID,ReferenceNumber,CategoryLevel1,CategoryName,CouncilDistrictNumber,PublicStatus,Address,DateCreated',
      orderByFields: 'DateCreated DESC',
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
      returnGeometry: true,
      outSR: 4326
    });
    const features = page.features || [];
    allFeatures.push(...features);
    if (features.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { type: 'FeatureCollection', features: allFeatures };
}

function renderBars(rows) {
  if (!rows.length) {
    elements.categoryBars.innerHTML = '<div class="request-item"><span>No category stats for this filter.</span></div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.count), 1);
  elements.categoryBars.innerHTML = rows.map((row) => `
    <div class="bar-row">
      <div class="bar-meta"><span>${row.label}</span><span>${row.count.toLocaleString()}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (row.count / max) * 100)}%"></div></div>
    </div>`).join('');
}

function featureTitle(feature) {
  return feature.properties.ReferenceNumber || `OBJECTID ${feature.properties.OBJECTID}`;
}

function requestHtml(feature) {
  const p = feature.properties;
  const date = p.DateCreated ? new Date(p.DateCreated).toLocaleDateString() : 'No date';
  return `
    <div class="popup-title">${featureTitle(feature)} · ${p.PublicStatus || 'Unknown'}</div>
    <div class="popup-line"><strong>Category:</strong> ${p.CategoryName || p.CategoryLevel1 || 'Uncategorized'}</div>
    <div class="popup-line"><strong>District:</strong> ${p.CouncilDistrictNumber || 'No district'}</div>
    <div class="popup-line"><strong>Date:</strong> ${date}</div>
    <div class="popup-line"><strong>Address:</strong> ${p.Address || 'Address unavailable'}</div>`;
}

function renderLatest(features) {
  if (!features.length) {
    elements.latestList.innerHTML = '<div class="request-item"><span>No mapped features match this filter.</span></div>';
    return;
  }

  elements.latestList.innerHTML = features.slice(0, 6).map((feature, index) => {
    const p = feature.properties;
    const date = p.DateCreated ? new Date(p.DateCreated).toLocaleDateString() : 'No date';
    return `
      <article class="request-item" data-feature-index="${index}">
        <strong>${featureTitle(feature) || 'New request'} · ${p.PublicStatus || 'Unknown'}</strong>
        <span>${p.CategoryName || p.CategoryLevel1 || 'Uncategorized'}</span>
        <span>${p.CouncilDistrictNumber || 'No district'} · ${date}</span>
        <span>${p.Address || 'Address unavailable'}</span>
      </article>`;
  }).join('');

  document.querySelectorAll('[data-feature-index]').forEach((item) => {
    item.addEventListener('click', () => {
      const feature = features[Number(item.dataset.featureIndex)];
      if (!feature?.geometry?.coordinates) return;
      map.flyTo({ center: feature.geometry.coordinates, zoom: 16, essential: true });
      new maplibregl.Popup().setLngLat(feature.geometry.coordinates).setHTML(requestHtml(feature)).addTo(map);
    });
  });
}

function setStatus(message) {
  elements.mapStatus.textContent = message;
}

function updateMapData(geojson) {
  const source = map.getSource('requests');
  if (source) source.setData(geojson);
  if (geojson.features.length) {
    const boundsArray = bbox(geojson);
    map.fitBounds([[boundsArray[0], boundsArray[1]], [boundsArray[2], boundsArray[3]]], { padding: 70, maxZoom: 13, duration: 700 });
  }
}

async function refreshApp() {
  const where = buildWhere();
  elements.refreshButton.disabled = true;
  setStatus('Fetching live 311 data via ArcGIS REST as GeoJSON…');
  try {
    const [total, open, closed, categories] = await Promise.all([
      countWhere(where),
      countWhere(`${where} AND UPPER(PublicStatus) <> 'CLOSED'`),
      countWhere(`${where} AND UPPER(PublicStatus) = 'CLOSED'`),
      categoryStats(where)
    ]);

    const geojson = await fetchAllFeatures(where, total);

    elements.totalCount.textContent = total.toLocaleString();
    elements.openCount.textContent = open.toLocaleString();
    elements.closedCount.textContent = closed.toLocaleString();
    renderBars(categories);
    renderLatest(geojson.features || []);
    updateMapData(geojson);
    setStatus(`Mapped all ${geojson.features.length.toLocaleString()} geocoded requests returned for the selected ${elements.daysSelect.value}-day window. Stats count ${total.toLocaleString()} matching records.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not load 311 data: ${error.message}`);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

map.on('load', async () => {
  map.addSource('requests', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 55
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'requests',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#38bdf8', 25, '#f97316', 100, '#dc2626'],
      'circle-radius': ['step', ['get', 'point_count'], 18, 25, 25, 100, 34],
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5
    }
  });

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'requests',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
    paint: { 'text-color': '#fff' }
  });

  map.addLayer({
    id: 'requests-open',
    type: 'circle',
    source: 'requests',
    filter: ['all', ['!', ['has', 'point_count']], ['!=', ['upcase', ['coalesce', ['get', 'PublicStatus'], '']], 'CLOSED']],
    paint: { 'circle-color': CATEGORY_COLOR_MATCH, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 15, 9], 'circle-opacity': 0.88, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4 }
  });

  map.addLayer({
    id: 'requests-closed',
    type: 'circle',
    source: 'requests',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['upcase', ['coalesce', ['get', 'PublicStatus'], '']], 'CLOSED']],
    paint: { 'circle-color': CATEGORY_COLOR_MATCH, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 6.5], 'circle-opacity': 0.38, 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 1 }
  });

  map.on('click', 'clusters', async (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: ['clusters'] });
    const clusterId = features[0].properties.cluster_id;
    const source = map.getSource('requests');
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: features[0].geometry.coordinates, zoom });
  });

  for (const layerId of ['requests-open', 'requests-closed']) {
    map.on('click', layerId, (event) => {
      const feature = event.features[0];
      new maplibregl.Popup().setLngLat(feature.geometry.coordinates).setHTML(requestHtml(feature)).addTo(map);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }

  ['daysSelect', 'categorySelect', 'statusSelect'].forEach((key) => elements[key].addEventListener('change', refreshApp));
  elements.refreshButton.addEventListener('click', refreshApp);
  await refreshApp();
});
