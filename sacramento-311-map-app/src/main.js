const SERVICE_URL = 'https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/SalesForce311_View/FeatureServer/0';
const SACRAMENTO_CENTER = [-121.4944, 38.5816];

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

  const category = elements.categorySelect.value;
  if (category) {
    clauses.push(`CategoryLevel1 = '${escapeSql(category)}'`);
  }

  const status = elements.statusSelect.value;
  if (status === 'CLOSED') {
    clauses.push("UPPER(PublicStatus) = 'CLOSED'");
  } else if (status === 'OPEN') {
    clauses.push("UPPER(PublicStatus) <> 'CLOSED'");
  }

  elements.windowLabel.textContent = `${days} days`;
  return clauses.join(' AND ');
}

function asCount(value) {
  return Number(value || 0).toLocaleString();
}

function setStatus(message) {
  elements.mapStatus.textContent = message;
}

function renderBars(rows) {
  if (!rows.length) {
    elements.categoryBars.innerHTML = '<div class="request-item"><span>No category statistics for this filter.</span></div>';
    return;
  }

  const max = Math.max(...rows.map((row) => row.count), 1);
  elements.categoryBars.innerHTML = rows.map((row) => `
    <div class="bar-row">
      <div class="bar-meta"><span>${row.label}</span><span>${row.count.toLocaleString()}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (row.count / max) * 100)}%"></div></div>
    </div>
  `).join('');
}

function renderLatest(features) {
  if (!features.length) {
    elements.latestList.innerHTML = '<div class="request-item"><span>No recent requests match this filter.</span></div>';
    return;
  }

  elements.latestList.innerHTML = features.map((feature) => {
    const attributes = feature.attributes;
    const date = attributes.DateCreated ? new Date(attributes.DateCreated).toLocaleDateString() : 'No date';
    const category = attributes.CategoryName || attributes.CategoryLevel1 || 'Uncategorized';
    const status = attributes.PublicStatus || 'Unknown';
    const district = attributes.CouncilDistrictNumber || 'No district';
    const address = attributes.Address || 'Address unavailable';
    return `
      <article class="request-item">
        <strong>${attributes.ReferenceNumber || `OBJECTID ${attributes.OBJECTID}`} · ${status}</strong>
        <span>${category}</span>
        <span>${district} · ${date}</span>
        <span>${address}</span>
      </article>
    `;
  }).join('');
}

require([
  'esri/Map',
  'esri/views/MapView',
  'esri/layers/FeatureLayer',
  'esri/widgets/Search',
  'esri/widgets/LayerList',
  'esri/widgets/Expand',
  'esri/renderers/UniqueValueRenderer',
  'esri/symbols/SimpleMarkerSymbol'
], function (Map, MapView, FeatureLayer, Search, LayerList, Expand, UniqueValueRenderer, SimpleMarkerSymbol) {
  const categoryPalette = {
    'Solid Waste': [14, 165, 233, 0.86],
    'Homeless Camp - Primary': [249, 115, 22, 0.88],
    'Other': [100, 116, 139, 0.78],
    'Streets': [168, 85, 247, 0.84],
    'Code Enforcement': [239, 68, 68, 0.86],
    'Animal Care': [34, 197, 94, 0.82],
    'Review': [234, 179, 8, 0.86]
  };

  function categorySymbol(category, size = 8) {
    return new SimpleMarkerSymbol({
      color: categoryPalette[category] || [15, 23, 42, 0.68],
      size,
      outline: { color: [255, 255, 255, 0.95], width: 1.2 }
    });
  }

  const featureLayer = new FeatureLayer({
    url: SERVICE_URL,
    title: 'Sacramento 311 service requests',
    outFields: ['OBJECTID', 'ReferenceNumber', 'CategoryLevel1', 'CategoryName', 'CouncilDistrictNumber', 'PublicStatus', 'Address', 'DateCreated'],
    definitionExpression: buildWhere(),
    popupTemplate: {
      title: '{ReferenceNumber} · {PublicStatus}',
      content: [
        {
          type: 'fields',
          fieldInfos: [
            { fieldName: 'CategoryName', label: 'Category' },
            { fieldName: 'CategoryLevel1', label: 'Category group' },
            { fieldName: 'CouncilDistrictNumber', label: 'Council district' },
            { fieldName: 'Address', label: 'Address' },
            { fieldName: 'DateCreated', label: 'Created', format: { dateFormat: 'short-date-short-time' } }
          ]
        }
      ]
    },
    renderer: new UniqueValueRenderer({
      field: 'CategoryLevel1',
      defaultSymbol: categorySymbol('Other', 7),
      defaultLabel: 'Other / uncategorized',
      uniqueValueInfos: Object.keys(categoryPalette).map((category) => ({
        value: category,
        symbol: categorySymbol(category, category === 'Code Enforcement' || category === 'Homeless Camp - Primary' ? 9 : 8),
        label: category
      })),
      visualVariables: [{
        type: 'opacity',
        field: 'DateCreated',
        stops: [
          { value: Date.now() - 7 * 24 * 60 * 60 * 1000, opacity: 0.92 },
          { value: Date.now() - 30 * 24 * 60 * 60 * 1000, opacity: 0.55 }
        ]
      }]
    }),
    featureReduction: {
      type: 'cluster',
      clusterRadius: '72px',
      popupTemplate: {
        title: 'Cluster summary',
        content: 'This cluster contains {cluster_count} 311 requests.'
      },
      labelingInfo: [{
        deconflictionStrategy: 'none',
        labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
        symbol: {
          type: 'text',
          color: 'white',
          font: { weight: 'bold', size: '12px' }
        },
        labelPlacement: 'center-center'
      }]
    }
  });

  const map = new Map({
    basemap: 'gray-vector',
    layers: [featureLayer]
  });

  const view = new MapView({
    container: 'viewDiv',
    map,
    center: SACRAMENTO_CENTER,
    zoom: 12,
    constraints: {
      snapToZoom: false
    }
  });

  view.ui.add(new Search({ view }), 'top-right');
  view.ui.add(new Expand({
    view,
    content: new LayerList({ view }),
    expandIcon: 'layers',
    expanded: false
  }), 'top-right');

  async function queryCount(where) {
    const query = featureLayer.createQuery();
    query.where = where;
    query.returnGeometry = false;
    return featureLayer.queryFeatureCount(query);
  }

  async function queryGroupedCategories(where) {
    const query = featureLayer.createQuery();
    query.where = where;
    query.outFields = ['CategoryLevel1'];
    query.groupByFieldsForStatistics = ['CategoryLevel1'];
    query.outStatistics = [{
      statisticType: 'count',
      onStatisticField: 'OBJECTID',
      outStatisticFieldName: 'request_count'
    }];
    query.orderByFields = ['request_count DESC'];
    query.num = 6;
    query.returnGeometry = false;
    const result = await featureLayer.queryFeatures(query);
    return result.features.map((feature) => ({
      label: feature.attributes.CategoryLevel1 || 'Unknown',
      count: Number(feature.attributes.request_count || 0)
    }));
  }

  async function queryLatest(where) {
    const query = featureLayer.createQuery();
    query.where = where;
    query.outFields = ['OBJECTID', 'ReferenceNumber', 'CategoryLevel1', 'CategoryName', 'CouncilDistrictNumber', 'PublicStatus', 'Address', 'DateCreated'];
    query.orderByFields = ['DateCreated DESC'];
    query.num = 6;
    query.returnGeometry = false;
    const result = await featureLayer.queryFeatures(query);
    return result.features;
  }

  async function refreshApp() {
    const where = buildWhere();
    featureLayer.definitionExpression = where;
    setStatus('Refreshing filtered map and dashboard…');

    try {
      const [total, open, closed, categories, latest] = await Promise.all([
        queryCount(where),
        queryCount(`${where} AND UPPER(PublicStatus) <> 'CLOSED'`),
        queryCount(`${where} AND UPPER(PublicStatus) = 'CLOSED'`),
        queryGroupedCategories(where),
        queryLatest(where)
      ]);

      elements.totalCount.textContent = asCount(total);
      elements.openCount.textContent = asCount(open);
      elements.closedCount.textContent = asCount(closed);
      renderBars(categories);
      renderLatest(latest);
      setStatus(`Showing ${asCount(total)} requests. Click a point or cluster for details.`);
    } catch (error) {
      console.error(error);
      setStatus(`Could not refresh data: ${error.message}`);
    }
  }

  elements.refreshButton.addEventListener('click', refreshApp);
  elements.daysSelect.addEventListener('change', refreshApp);
  elements.categorySelect.addEventListener('change', refreshApp);
  elements.statusSelect.addEventListener('change', refreshApp);

  view.when(async () => {
    await featureLayer.when();
    await refreshApp();
  }).catch((error) => {
    console.error(error);
    setStatus(`Map failed to load: ${error.message}`);
  });
});
