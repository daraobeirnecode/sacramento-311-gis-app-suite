import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import bbox from '@turf/bbox';
import './style.css';

const SERVICE_URL = 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0/query';
const MAX_DISPLAY_FEATURES = 250;
const DEFAULT_CENTER = [38.5816, -121.4944];
const DEFAULT_ZOOM = 11;
const CATEGORY_COLORS = {
  'Solid Waste': '#0ea5e9',
  'Homeless Camp': '#f97316',
  'Homeless Camp - Primary': '#f97316',
  'Other': '#64748b',
  'Review': '#eab308',
  'Animal Control': '#22c55e',
  'Code Enforcement': '#ef4444',
  'Streets': '#a855f7',
  'Parking': '#14b8a6',
  'Water': '#2563eb'
};

const FIELD_CANDIDATES = {
  category: ['CategoryName', 'CategoryLevel2', 'CategoryLevel1', 'RequestType', 'Type', 'Category', 'Subject', 'ServiceName'],
  status: ['PublicStatus', 'Status', 'RequestStatus'],
  date: ['DateCreated', 'CreatedDate', 'Created_Date', 'DateOpened', 'OpenedDate', 'CreationDate'],
  id: ['ReferenceNumber', 'SRNumber', 'ServiceRequestID', 'CaseNumber', 'OBJECTID'],
  address: ['Address', 'StreetAddress', 'Location', 'FullAddress', 'CrossStreet'],
  district: ['CouncilDistrictNumber', 'CouncilDistrict', 'District', 'Council_District'],
};

const els = {
  timeWindow: document.querySelector('#time-window'),
  statusFilter: document.querySelector('#status-filter'),
  categoryFilter: document.querySelector('#category-filter'),
  refreshButton: document.querySelector('#refresh-button'),
  loadingState: document.querySelector('#loading-state'),
  totalCount: document.querySelector('#total-count'),
  openCount: document.querySelector('#open-count'),
  closedCount: document.querySelector('#closed-count'),
  categoryWindowLabel: document.querySelector('#category-window-label'),
  categoryList: document.querySelector('#category-list'),
  requestList: document.querySelector('#request-list'),
};

const map = L.map('map', {
  zoomControl: false,
  preferCanvas: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const clusterLayer = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 46,
  iconCreateFunction(cluster) {
    const count = cluster.getChildCount();
    const size = count >= 100 ? 'large' : count >= 25 ? 'medium' : 'small';
    return L.divIcon({
      html: `<div><span>${count.toLocaleString()}</span></div>`,
      className: `marker-cluster marker-cluster-${size}`,
      iconSize: L.point(size === 'large' ? 54 : size === 'medium' ? 46 : 38, size === 'large' ? 54 : size === 'medium' ? 46 : 38),
    });
  },
});
map.addLayer(clusterLayer);

let fields = {};
let latestFeatures = [];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pickField(attributes, candidates) {
  return candidates.find((field) => Object.prototype.hasOwnProperty.call(attributes, field));
}

function detectFields(sampleAttributes) {
  fields = Object.fromEntries(
    Object.entries(FIELD_CANDIDATES).map(([key, candidates]) => [key, pickField(sampleAttributes, candidates)]),
  );
}

function attr(feature, key) {
  const field = fields[key];
  return field ? feature.properties[field] : undefined;
}

function featureTitle(feature) {
  return attr(feature, 'id') || feature.properties.OBJECTID || 'New request';
}

function statusWhereClause() {
  const statusField = fields.status || 'PublicStatus';
  const value = els.statusFilter.value;
  if (value === 'closed') {
    return `UPPER(${statusField}) LIKE '%CLOSED%'`;
  }
  if (value === 'open') {
    return `UPPER(${statusField}) NOT LIKE '%CLOSED%'`;
  }
  return '1=1';
}

function selectedCategoryWhereClause() {
  const categoryField = fields.category || 'RequestType';
  const category = els.categoryFilter.value;
  if (!category || category === 'all') return '1=1';
  return `${categoryField} = '${category.replaceAll("'", "''")}'`;
}

function dateWhereClause() {
  const dateField = fields.date || 'CreatedDate';
  const days = Number(els.timeWindow.value || 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${dateField} >= DATE '${since.toISOString().slice(0, 10)}'`;
}

function currentWhereClause({ includeCategory = true } = {}) {
  return [dateWhereClause(), statusWhereClause(), includeCategory ? selectedCategoryWhereClause() : '1=1'].join(' AND ');
}

async function queryArcgis(params) {
  const url = new URL(SERVICE_URL);
  url.search = new URLSearchParams({ f: 'json', ...params }).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ArcGIS REST request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'ArcGIS REST returned an error');
  }
  return data;
}

function arcgisFeaturesToGeoJson(features) {
  return {
    type: 'FeatureCollection',
    features: features
      .filter((feature) => feature.geometry && Number.isFinite(feature.geometry.x) && Number.isFinite(feature.geometry.y))
      .map((feature) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [feature.geometry.x, feature.geometry.y],
        },
        properties: feature.attributes,
      })),
  };
}

async function loadMetadata() {
  const data = await queryArcgis({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '1',
  });
  const attributes = data.features?.[0]?.attributes || {};
  detectFields(attributes);
}

async function loadCategories() {
  const categoryField = fields.category || 'RequestType';
  const data = await queryArcgis({
    where: currentWhereClause({ includeCategory: false }),
    outFields: categoryField,
    returnGeometry: 'false',
    groupByFieldsForStatistics: categoryField,
    outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: categoryField, outStatisticFieldName: 'total' }]),
    orderByFields: 'total DESC',
    resultRecordCount: '60',
  });

  const currentValue = els.categoryFilter.value;
  els.categoryFilter.innerHTML = '<option value="all">All categories</option>';
  for (const feature of data.features || []) {
    const category = feature.attributes[categoryField];
    if (!category) continue;
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    els.categoryFilter.append(option);
  }
  if ([...els.categoryFilter.options].some((option) => option.value === currentValue)) {
    els.categoryFilter.value = currentValue;
  }

  renderTopCategories(data.features || [], categoryField);
}

async function loadCounts() {
  const statusField = fields.status || 'PublicStatus';
  const where = currentWhereClause();
  const [total, closed] = await Promise.all([
    queryArcgis({ where, returnCountOnly: 'true' }),
    queryArcgis({ where: `${where} AND UPPER(${statusField}) LIKE '%CLOSED%'`, returnCountOnly: 'true' }),
  ]);
  const totalCount = total.count || 0;
  const closedCount = closed.count || 0;
  els.totalCount.textContent = formatNumber(totalCount);
  els.closedCount.textContent = formatNumber(closedCount);
  els.openCount.textContent = formatNumber(Math.max(totalCount - closedCount, 0));
}

async function loadFeatures() {
  const data = await queryArcgis({
    where: currentWhereClause(),
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
    resultRecordCount: String(MAX_DISPLAY_FEATURES),
    orderByFields: `${fields.date || 'CreatedDate'} DESC`,
  });
  return arcgisFeaturesToGeoJson(data.features || []);
}

function popupHtml(feature) {
  return `
    <article class="popup-card">
      <strong>${escapeHtml(featureTitle(feature))} · ${escapeHtml(attr(feature, 'status') || 'Unknown')}</strong>
      <span>${escapeHtml(attr(feature, 'category') || 'Uncategorised')}</span>
      <small>${escapeHtml(attr(feature, 'address') || 'No address supplied')}</small>
      <small>${escapeHtml(attr(feature, 'district') ? `District ${attr(feature, 'district')}` : 'District unknown')}</small>
    </article>
  `;
}

function categoryColor(feature) {
  const category = String(attr(feature, 'category') || 'Other');
  const key = Object.keys(CATEGORY_COLORS).find((candidate) => category.includes(candidate));
  return CATEGORY_COLORS[key] || '#334155';
}

function markerForFeature(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const isClosed = String(attr(feature, 'status') || '').toUpperCase().includes('CLOSED');
  const color = categoryColor(feature);
  const marker = L.circleMarker([lat, lng], {
    radius: isClosed ? 5.5 : 7.5,
    color: isClosed ? '#2563eb' : '#ffffff',
    weight: isClosed ? 1.1 : 1.8,
    fillColor: color,
    fillOpacity: isClosed ? 0.42 : 0.9,
  });
  marker.bindPopup(popupHtml(feature), { maxWidth: 280 });
  return marker;
}

function renderFeatures(geojson) {
  latestFeatures = geojson.features;
  clusterLayer.clearLayers();
  latestFeatures.forEach((feature) => clusterLayer.addLayer(markerForFeature(feature)));

  if (latestFeatures.length > 0) {
    const [minX, minY, maxX, maxY] = bbox(geojson);
    map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [28, 28], maxZoom: 13 });
  }
  renderRequestList(latestFeatures);
}

function renderTopCategories(features, categoryField) {
  els.categoryWindowLabel.textContent = `${els.timeWindow.value} days`;
  els.categoryList.innerHTML = '';
  const max = Math.max(...features.slice(0, 8).map((feature) => feature.attributes.total || 0), 1);
  for (const feature of features.slice(0, 8)) {
    const category = feature.attributes[categoryField] || 'Uncategorised';
    const count = feature.attributes.total || 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'category-row';
    row.innerHTML = `
      <span><strong>${escapeHtml(category)}</strong><em>${formatNumber(count)}</em></span>
      <i style="width:${Math.max((count / max) * 100, 4)}%"></i>
    `;
    row.addEventListener('click', () => {
      els.categoryFilter.value = category;
      refreshData();
    });
    els.categoryList.append(row);
  }
}

function renderRequestList(features) {
  els.requestList.innerHTML = '';
  if (!features.length) {
    els.requestList.innerHTML = '<p class="empty">No mapped requests match the current filters.</p>';
    return;
  }

  for (const feature of features.slice(0, 30)) {
    const [lng, lat] = feature.geometry.coordinates;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'request-item';
    item.innerHTML = `
      <strong>${escapeHtml(featureTitle(feature))} · ${escapeHtml(attr(feature, 'status') || 'Unknown')}</strong>
      <span>${escapeHtml(attr(feature, 'category') || 'Uncategorised')}</span>
      <small>${escapeHtml(attr(feature, 'address') || 'No address supplied')}</small>
    `;
    item.addEventListener('click', () => {
      map.flyTo([lat, lng], 16, { duration: 0.7 });
      L.popup({ maxWidth: 280 })
        .setLatLng([lat, lng])
        .setContent(popupHtml(feature))
        .openOn(map);
    });
    els.requestList.append(item);
  }
}

async function refreshData() {
  try {
    els.refreshButton.disabled = true;
    els.loadingState.textContent = 'Querying public Sacramento 311 FeatureServer…';
    await Promise.all([loadCounts(), loadCategories()]);
    const geojson = await loadFeatures();
    renderFeatures(geojson);
    els.loadingState.textContent = `Showing ${formatNumber(geojson.features.length)} mapped requests from the latest matching records.`;
  } catch (error) {
    console.error(error);
    els.loadingState.textContent = `Data load failed: ${error.message}`;
  } finally {
    els.refreshButton.disabled = false;
  }
}

async function boot() {
  try {
    await loadMetadata();
    await refreshData();
  } catch (error) {
    console.error(error);
    els.loadingState.textContent = `Startup failed: ${error.message}`;
  }
}

[els.timeWindow, els.statusFilter, els.categoryFilter].forEach((element) => {
  element.addEventListener('change', refreshData);
});
els.refreshButton.addEventListener('click', refreshData);

boot();
