import maplibregl from 'maplibre-gl';
import bbox from '@turf/bbox';
import './style.css';

const SERVICE_URL = 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0';
const CENTER = [-121.4944, 38.5816];
const PAGE_SIZE = 2000;
const HOTSPOT_PRECISION = 0.0045;

const LENS_KEYWORDS = {
  sidewalk: ['SIDEWALK', 'BLOCKING'],
  critical: ['CRITICAL INFRASTRUCTURE', 'FOCUS AREA'],
  trash: ['TRASH', 'CLEANUP'],
  vehicle: ['OCCUPIED VEHICLE', 'VEHICLE'],
  park: ['PARK', 'BIKE TRAIL'],
  private: ['PRIVATE PROPERTY'],
};

const els = {
  daysSelect: document.querySelector('#daysSelect'),
  statusSelect: document.querySelector('#statusSelect'),
  lensSelect: document.querySelector('#lensSelect'),
  refreshButton: document.querySelector('#refreshButton'),
  windowBadge: document.querySelector('#windowBadge'),
  totalCount: document.querySelector('#totalCount'),
  totalSub: document.querySelector('#totalSub'),
  newCount: document.querySelector('#newCount'),
  progressCount: document.querySelector('#progressCount'),
  agedCount: document.querySelector('#agedCount'),
  managerBrief: document.querySelector('#managerBrief'),
  briefStamp: document.querySelector('#briefStamp'),
  hotspotList: document.querySelector('#hotspotList'),
  districtList: document.querySelector('#districtList'),
  priorityList: document.querySelector('#priorityList'),
  mapStatus: document.querySelector('#mapStatus'),
};

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: CENTER,
  zoom: 11.2,
  attributionControl: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : 'No date';
}

function arcgisTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `timestamp '${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}'`;
}

function homelessBaseWhere() {
  return [
    "UPPER(CategoryLevel1) LIKE '%HOMELESS%'",
    "UPPER(CategoryName) LIKE '%HOMELESS%'",
    "UPPER(CategoryLevel1) LIKE '%CAMP%'",
    "UPPER(CategoryName) LIKE '%CAMP%'",
  ].join(' OR ');
}

function currentWhere() {
  const days = Number(els.daysSelect.value || 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const clauses = [`DateCreated >= ${arcgisTimestamp(since)}`, `(${homelessBaseWhere()})`];

  const status = els.statusSelect.value;
  if (status === 'OPEN') clauses.push("UPPER(PublicStatus) <> 'CLOSED'");
  if (status === 'CLOSED') clauses.push("UPPER(PublicStatus) = 'CLOSED'");
  if (status === 'NEW') clauses.push("UPPER(PublicStatus) = 'NEW'");
  if (status === 'IN PROGRESS') clauses.push("UPPER(PublicStatus) = 'IN PROGRESS'");

  const lens = els.lensSelect.value;
  if (lens !== 'all') {
    const terms = LENS_KEYWORDS[lens] || [];
    const lensWhere = terms.map((term) => `UPPER(CategoryName) LIKE '%${escapeSql(term)}%'`).join(' OR ');
    clauses.push(`(${lensWhere})`);
  }

  const statusText = els.statusSelect.selectedOptions[0]?.textContent || 'All statuses';
  els.windowBadge.textContent = `${statusText} · Last ${days} days`;
  return clauses.join(' AND ');
}

async function arcgisQuery(params) {
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
  const json = await arcgisQuery({ where, returnCountOnly: true, returnGeometry: false });
  return Number(json.count || 0);
}

async function fetchAllFeatures(where, total) {
  const features = [];
  let offset = 0;
  while (offset < Math.max(total, 1)) {
    setStatus(`Loading operational layer… ${formatNumber(features.length)} of ${formatNumber(total)} records`);
    const page = await arcgisQuery({
      where,
      outFields: 'OBJECTID,ReferenceNumber,CategoryLevel1,CategoryName,CouncilDistrictNumber,PublicStatus,Address,DateCreated,DateClosed',
      returnGeometry: true,
      outSR: 4326,
      orderByFields: 'DateCreated DESC',
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
    });
    const pageFeatures = page.features || [];
    features.push(...pageFeatures);
    if (pageFeatures.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return toGeoJson(features);
}

function toGeoJson(features) {
  return {
    type: 'FeatureCollection',
    features: features
      .filter((feature) => feature.geometry && Number.isFinite(feature.geometry.x) && Number.isFinite(feature.geometry.y))
      .map((feature) => {
        const properties = { ...feature.attributes };
        properties.priorityScore = priorityScore(properties);
        properties.priorityClass = priorityClass(properties.priorityScore);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [feature.geometry.x, feature.geometry.y] },
          properties,
        };
      }),
  };
}

function ageDays(p) {
  return p.DateCreated ? Math.max(0, Math.floor((Date.now() - Number(p.DateCreated)) / 86400000)) : 0;
}

function categoryText(p) {
  return String(p.CategoryName || p.CategoryLevel1 || 'Uncategorised');
}

function priorityScore(p) {
  const category = categoryText(p).toUpperCase();
  const status = String(p.PublicStatus || '').toUpperCase();
  let score = 1;
  if (status === 'NEW') score += 3;
  if (status === 'IN PROGRESS') score += 2;
  if (ageDays(p) >= 7) score += 3;
  if (ageDays(p) >= 14) score += 2;
  if (category.includes('BLOCKING SIDEWALK')) score += 4;
  if (category.includes('CRITICAL INFRASTRUCTURE')) score += 4;
  if (category.includes('OCCUPIED VEHICLE')) score += 3;
  if (category.includes('PARK') || category.includes('BIKE TRAIL')) score += 2;
  if (category.includes('TRASH')) score += 2;
  if (category.includes('PRIVATE PROPERTY')) score += 2;
  return score;
}

function priorityClass(score) {
  if (score >= 8) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function hotspotKey([lng, lat]) {
  const x = Math.round(lng / HOTSPOT_PRECISION) * HOTSPOT_PRECISION;
  const y = Math.round(lat / HOTSPOT_PRECISION) * HOTSPOT_PRECISION;
  return `${x.toFixed(4)},${y.toFixed(4)}`;
}

function buildHotspots(features) {
  const groups = new Map();
  for (const feature of features) {
    const key = hotspotKey(feature.geometry.coordinates);
    const group = groups.get(key) || { key, count: 0, newCount: 0, aged: 0, score: 0, coords: feature.geometry.coordinates, districts: new Map(), categories: new Map(), features: [] };
    group.count += 1;
    group.score += feature.properties.priorityScore || 0;
    if (String(feature.properties.PublicStatus).toUpperCase() === 'NEW') group.newCount += 1;
    if (ageDays(feature.properties) >= 7) group.aged += 1;
    const district = feature.properties.CouncilDistrictNumber || 'No district';
    const category = categoryText(feature.properties);
    group.districts.set(district, (group.districts.get(district) || 0) + 1);
    group.categories.set(category, (group.categories.get(category) || 0) + 1);
    group.features.push(feature);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.count >= 2)
    .map((group) => ({
      ...group,
      avgScore: group.score / group.count,
      topDistrict: topEntry(group.districts)[0],
      topCategory: topEntry(group.categories)[0],
    }))
    .sort((a, b) => (b.count * 2 + b.avgScore + b.aged) - (a.count * 2 + a.avgScore + a.aged));
}

function topEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0] || ['Unknown', 0];
}

function summarizeBy(features, field) {
  const map = new Map();
  for (const feature of features) {
    const value = feature.properties[field] || 'Unknown';
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function setStatus(message) {
  els.mapStatus.textContent = message;
}

function popupHtml(feature) {
  const p = feature.properties;
  return `
    <div class="popup-title">${escapeHtml(p.ReferenceNumber || `OBJECTID ${p.OBJECTID}`)} · ${escapeHtml(p.PublicStatus || 'Unknown')}</div>
    <div class="popup-line"><strong>Priority:</strong> ${p.priorityScore} / ${priorityClass(p.priorityScore).toUpperCase()}</div>
    <div class="popup-line"><strong>Category:</strong> ${escapeHtml(categoryText(p))}</div>
    <div class="popup-line"><strong>District:</strong> ${escapeHtml(p.CouncilDistrictNumber || 'Unknown')}</div>
    <div class="popup-line"><strong>Age:</strong> ${ageDays(p)} days · created ${formatDate(p.DateCreated)}</div>
    <div class="popup-line"><strong>Address:</strong> ${escapeHtml(p.Address || 'Address unavailable')}</div>`;
}

function updateMap(geojson) {
  const source = map.getSource('reports');
  if (source) source.setData(geojson);
  if (geojson.features.length) {
    const boundsArray = bbox(geojson);
    map.fitBounds([[boundsArray[0], boundsArray[1]], [boundsArray[2], boundsArray[3]]], { padding: 80, maxZoom: 13, duration: 800 });
  }
}

function renderHotspots(hotspots) {
  if (!hotspots.length) {
    els.hotspotList.innerHTML = '<div class="item"><strong>No repeat hotspots in this filter.</strong><span>Try all statuses or a longer time window.</span></div>';
    return;
  }
  els.hotspotList.innerHTML = hotspots.slice(0, 8).map((hotspot, index) => `
    <button class="item ${index < 3 ? 'high' : 'medium'}" data-hotspot="${index}" type="button">
      <strong>${formatNumber(hotspot.count)} reports · ${escapeHtml(hotspot.topDistrict)}</strong>
      <span>${escapeHtml(hotspot.topCategory)}</span>
      <small>${formatNumber(hotspot.newCount)} new · ${formatNumber(hotspot.aged)} aged 7+ days · avg priority ${hotspot.avgScore.toFixed(1)}</small>
    </button>`).join('');
  document.querySelectorAll('[data-hotspot]').forEach((item) => {
    item.addEventListener('click', () => {
      const hotspot = hotspots[Number(item.dataset.hotspot)];
      map.flyTo({ center: hotspot.coords, zoom: 15.5, essential: true });
    });
  });
}

function renderDistricts(features) {
  const rows = summarizeBy(features, 'CouncilDistrictNumber').slice(0, 9);
  els.districtList.innerHTML = rows.map((row) => `
    <div class="item"><strong>${escapeHtml(row.label)}</strong><span>${formatNumber(row.count)}</span></div>`).join('') || '<div class="item"><strong>No districts found.</strong></div>';
}

function renderPriorityQueue(features) {
  const queue = [...features]
    .sort((a, b) => (b.properties.priorityScore - a.properties.priorityScore) || (Number(a.properties.DateCreated || 0) - Number(b.properties.DateCreated || 0)))
    .slice(0, 12);
  els.priorityList.innerHTML = queue.map((feature, index) => {
    const p = feature.properties;
    return `
      <button class="item ${priorityClass(p.priorityScore)}" data-feature="${index}" type="button">
        <strong>${escapeHtml(p.ReferenceNumber || `OBJECTID ${p.OBJECTID}`)} · score ${p.priorityScore}</strong>
        <span>${escapeHtml(categoryText(p))}</span>
        <small>${escapeHtml(p.CouncilDistrictNumber || 'Unknown')} · ${ageDays(p)} days old · ${escapeHtml(p.Address || 'Address unavailable')}</small>
      </button>`;
  }).join('') || '<div class="item"><strong>No priority records in this filter.</strong></div>';
  document.querySelectorAll('[data-feature]').forEach((item) => {
    item.addEventListener('click', () => {
      const feature = queue[Number(item.dataset.feature)];
      map.flyTo({ center: feature.geometry.coordinates, zoom: 16, essential: true });
      new maplibregl.Popup().setLngLat(feature.geometry.coordinates).setHTML(popupHtml(feature)).addTo(map);
    });
  });
}

function renderBrief(features, hotspots, total, newCount, progressCount, agedCount) {
  const district = summarizeBy(features, 'CouncilDistrictNumber')[0]?.label || 'no district concentration';
  const topCategory = summarizeBy(features, 'CategoryName')[0]?.label || 'no dominant category';
  const leadingHotspot = hotspots[0];
  const hotspotText = leadingHotspot ? `${formatNumber(leadingHotspot.count)} repeat reports near ${leadingHotspot.topDistrict}` : 'no repeat hotspot in the current filter';
  els.managerBrief.innerHTML = `
    <strong>${formatNumber(total)} matching homeless-related reports</strong> in the current operational filter, including
    <strong>${formatNumber(newCount)} new</strong>, <strong>${formatNumber(progressCount)} in progress</strong>, and
    <strong>${formatNumber(agedCount)} aged 7+ days</strong>. Highest workload is <strong>${escapeHtml(district)}</strong>.
    Dominant issue type is <strong>${escapeHtml(topCategory)}</strong>. Top hotspot has <strong>${hotspotText}</strong>.
    Use this as a morning triage board: clear high-score queue, inspect repeat hotspots, then balance district workload.`;
  els.briefStamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function refreshApp() {
  els.refreshButton.disabled = true;
  const where = currentWhere();
  setStatus('Counting homeless-related 311 workload…');
  try {
    const [total, newCount, progressCount, agedCount] = await Promise.all([
      countWhere(where),
      countWhere(`${where} AND UPPER(PublicStatus) = 'NEW'`),
      countWhere(`${where} AND UPPER(PublicStatus) = 'IN PROGRESS'`),
      countWhere(`${where} AND DateCreated <= ${arcgisTimestamp(new Date(Date.now() - 7 * 86400000))}`),
    ]);

    els.totalCount.textContent = formatNumber(total);
    els.newCount.textContent = formatNumber(newCount);
    els.progressCount.textContent = formatNumber(progressCount);
    els.agedCount.textContent = formatNumber(agedCount);
    els.totalSub.textContent = `${els.statusSelect.selectedOptions[0]?.textContent || 'filtered'} workload`;

    const geojson = await fetchAllFeatures(where, total);
    updateMap(geojson);
    const features = geojson.features;
    const hotspots = buildHotspots(features);
    renderHotspots(hotspots);
    renderDistricts(features);
    renderPriorityQueue(features);
    renderBrief(features, hotspots, total, newCount, progressCount, agedCount);
    setStatus(`Mapped ${formatNumber(features.length)} geocoded homeless-related records. Stats count ${formatNumber(total)} matching 311 reports.`);
  } catch (error) {
    console.error(error);
    setStatus(`Dashboard failed: ${error.message}`);
    els.managerBrief.textContent = `Data load failed: ${error.message}`;
  } finally {
    els.refreshButton.disabled = false;
  }
}

map.on('load', async () => {
  map.addSource('reports', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 58,
    clusterMaxZoom: 14,
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'reports',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#0ea5e9', 20, '#f97316', 75, '#dc2626', 200, '#7c3aed'],
      'circle-radius': ['step', ['get', 'point_count'], 18, 20, 25, 75, 34, 200, 42],
      'circle-opacity': 0.92,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.6,
    },
  });

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'reports',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#ffffff' },
  });

  map.addLayer({
    id: 'reports-low',
    type: 'circle',
    source: 'reports',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'priorityClass'], 'low']],
    paint: { 'circle-color': '#0ea5e9', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 8], 'circle-opacity': 0.72, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 },
  });

  map.addLayer({
    id: 'reports-medium',
    type: 'circle',
    source: 'reports',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'priorityClass'], 'medium']],
    paint: { 'circle-color': '#f97316', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10], 'circle-opacity': 0.86, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4 },
  });

  map.addLayer({
    id: 'reports-high',
    type: 'circle',
    source: 'reports',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'priorityClass'], 'high']],
    paint: { 'circle-color': '#dc2626', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7.5, 15, 12], 'circle-opacity': 0.94, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.8 },
  });

  map.on('click', 'clusters', async (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: ['clusters'] });
    const clusterId = features[0].properties.cluster_id;
    const source = map.getSource('reports');
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: features[0].geometry.coordinates, zoom });
  });

  for (const layer of ['reports-low', 'reports-medium', 'reports-high']) {
    map.on('click', layer, (event) => {
      const feature = event.features[0];
      new maplibregl.Popup().setLngLat(feature.geometry.coordinates).setHTML(popupHtml(feature)).addTo(map);
    });
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }

  [els.daysSelect, els.statusSelect, els.lensSelect].forEach((element) => element.addEventListener('change', refreshApp));
  els.refreshButton.addEventListener('click', refreshApp);
  await refreshApp();
});
