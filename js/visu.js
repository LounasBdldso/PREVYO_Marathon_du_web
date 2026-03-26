function getEventAnomalyScore(event) {
  const raw = event?.anomaly?.score ?? event?.anomaly_score ?? event?.score_final ?? 0;
  const score = Number(raw);
  return Number.isFinite(score) ? score : 0;
}

function topEntries(collection, limit = 10) {
  const entries = collection instanceof Map
    ? [...collection.entries()]
    : Object.entries(collection || {});
  return entries.sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function buildHistogram(values, bucketCount = 10, min = 0, max = 1) {
  const span = max - min;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    label: `${(min + (span / bucketCount) * index).toFixed(1)}-${(min + (span / bucketCount) * (index + 1)).toFixed(1)}`,
    value: 0
  }));

  values.forEach(value => {
    const safeValue = Math.max(min, Math.min(max, Number(value) || 0));
    const ratio = span === 0 ? 0 : (safeValue - min) / span;
    const index = Math.min(bucketCount - 1, Math.floor(ratio * bucketCount));
    buckets[index].value += 1;
  });

  return buckets;
}

function destroyVisuCharts() {
  if (!Array.isArray(state.visuCharts)) state.visuCharts = [];

  state.visuCharts.forEach(chart => {
    try {
      chart.destroy();
    } catch (err) {
      console.warn('Impossible de detruire un chart existant', err);
    }
  });

  state.visuCharts = [];
  state.visuChartsBuilt = false;
}

function resizeVisuCharts() {
  if (!Array.isArray(state.visuCharts)) return;

  state.visuCharts.forEach(chart => {
    try {
      chart.resize();
    } catch (err) {
      console.warn('Impossible de redimensionner un chart', err);
    }
  });
}

function registerVisuChart(chart) {
  state.visuCharts.push(chart);
  return chart;
}

function bindTreemapControls() {
  const treemapField = document.getElementById('treemap-field');
  const treemapSearch = document.getElementById('treemap-search');
  const treemapReset = document.getElementById('treemap-reset');

  if (treemapField && !treemapField.dataset.bound) {
    treemapField.addEventListener('change', () => buildTreemap());
    treemapField.dataset.bound = '1';
  }

  if (treemapSearch && !treemapSearch.dataset.bound) {
    treemapSearch.addEventListener('input', e => applyTreemapSearch(e.target.value));
    treemapSearch.dataset.bound = '1';
  }

  if (treemapReset && !treemapReset.dataset.bound) {
    treemapReset.addEventListener('click', () => {
      hideTreemapBreadcrumb();
      if (typeof resetTreemapView === 'function') {
        resetTreemapView(true);
      } else if (treemapSvg && treemapZoom) {
        treemapSvg.transition().duration(600).call(treemapZoom.transform, d3.zoomIdentity);
      }
    });
    treemapReset.dataset.bound = '1';
  }
}

function removeLegacyVisuSections() {
  const page = document.getElementById('page-visu');
  if (!page) return;

  const sections = [...page.querySelectorAll('section.section')];
  sections.forEach(section => {
    const title = section.querySelector('.section-title')?.textContent?.trim() || '';
    if (
      title.includes('Les graphiques exploratoires qui méritaient d’être remontés dans l’interface') ||
      title.includes('Dashboards et apps annexes qui nourrissent cette interface')
    ) {
      section.remove();
    }
  });
}

function ensureVisuDashboardControls() {
  const chartsGrid = document.getElementById('visu-charts');
  if (!chartsGrid) return;

  let toolbar = document.getElementById('visu-dashboard-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'visu-dashboard-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.flexWrap = 'wrap';
    toolbar.style.gap = '0.65rem';
    toolbar.style.alignItems = 'center';
    toolbar.style.margin = '0 0 1rem 0';
    toolbar.style.padding = '0.95rem 1rem';
    toolbar.style.border = '1px solid var(--border)';
    toolbar.style.borderRadius = '14px';
    toolbar.style.background = 'rgba(11,26,48,0.72)';
    toolbar.style.backdropFilter = 'blur(8px)';

    toolbar.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.2rem;min-width:210px;margin-right:0.8rem">
        <strong style="font-size:0.92rem;color:var(--text)">Personnaliser le tableau de bord</strong>
        <span style="font-size:0.76rem;color:var(--muted)">Afficher uniquement les blocs utiles pour la lecture métier.</span>
      </div>
      <div id="visu-dashboard-filters" style="display:flex;flex-wrap:wrap;gap:0.5rem"></div>
    `;

    chartsGrid.parentNode.insertBefore(toolbar, chartsGrid);
  }

  const filters = document.getElementById('visu-dashboard-filters');
  if (!filters || filters.dataset.bound === '1') return;

  const groups = [
    { key: 'overview', label: 'Vue d’ensemble' },
    { key: 'anomaly', label: 'Anomalies' },
    { key: 'structure', label: 'Structure du graphe' },
    { key: 'cluster', label: 'Clusters' },
    { key: 'semantics', label: 'Sémantique' }
  ];

  filters.innerHTML = groups.map(group => `
    <button
      type="button"
      class="visu-filter-chip active"
      data-filter="${group.key}"
      style="
        border:1px solid var(--border);
        background:rgba(255,255,255,0.03);
        color:var(--text);
        border-radius:999px;
        padding:0.55rem 0.85rem;
        font:600 0.78rem Lexend,sans-serif;
        cursor:pointer;
        transition:all 0.2s ease;
      "
    >${group.label}</button>
  `).join('');

  filters.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      button.classList.toggle('active');
      const active = button.classList.contains('active');
      button.style.borderColor = active ? 'var(--teal)' : 'var(--border)';
      button.style.color = active ? 'var(--teal)' : 'var(--text)';
      button.style.background = active ? 'rgba(27,174,159,0.08)' : 'rgba(255,255,255,0.03)';
      applyVisuCardFilters();
      resizeVisuCharts();
    });

    button.style.borderColor = 'var(--teal)';
    button.style.color = 'var(--teal)';
    button.style.background = 'rgba(27,174,159,0.08)';
  });

  filters.dataset.bound = '1';
}

function getActiveVisuFilters() {
  const buttons = [...document.querySelectorAll('#visu-dashboard-filters [data-filter].active')];
  return new Set(buttons.map(btn => btn.dataset.filter));
}

function applyVisuCardFilters() {
  const active = getActiveVisuFilters();
  const cards = [...document.querySelectorAll('#visu-charts .chart-card')];

  cards.forEach(card => {
    const group = card.dataset.group || 'overview';
    card.style.display = active.has(group) ? '' : 'none';
  });
}

function enhanceVisuCardsContent() {
  const page = document.getElementById('page-visu');
  if (!page) return;

  const title = page.querySelector('.visu-header .section-title');
  const desc = page.querySelector('.visu-header .section-desc');
  const pills = page.querySelector('.visu-meta-row');

  if (title) title.textContent = 'Tableau de bord analytique du corpus';
  if (desc) {
    desc.textContent = 'Cette vue regroupe les indicateurs principaux du dataset et les visualisations prioritaires pour analyser les alertes, la structure des sous-graphes, les regroupements et les relations sémantiques.';
  }
  if (pills) {
    pills.innerHTML = `
      <span class="visu-pill">Vue pilotage</span>
      <span class="visu-pill">Indicateurs qualité</span>
      <span class="visu-pill">Lecture multi-niveaux</span>
    `;
  }

  const cards = [...document.querySelectorAll('#visu-charts .chart-card')];
  const config = [
    {
      id: 'chart-anomaly',
      group: 'anomaly',
      order: 1,
      title: 'Répartition des niveaux d’alerte',
      text: 'Part relative des événements normaux, suspects et critiques dans le corpus actif.'
    },
    {
      id: 'chart-scores',
      group: 'anomaly',
      order: 2,
      title: 'Distribution des scores d’anomalie',
      text: 'Lecture continue du score pour repérer la concentration des cas faibles, intermédiaires et élevés.'
    },
    {
      id: 'chart-article-alerts',
      group: 'anomaly',
      order: 3,
      title: 'Articles les plus exposés',
      text: 'Articles concentrant le plus de signaux suspects et critiques.'
    },
    {
      id: 'chart-types',
      group: 'overview',
      order: 4,
      title: 'Typologie dominante des événements',
      text: 'Familles d’événements les plus représentées dans le dataset actif.'
    },
    {
      id: 'chart-clusters',
      group: 'cluster',
      order: 5,
      title: 'Clusters les plus représentés',
      text: 'Groupes les plus peuplés parmi les annotations de clustering conservées.'
    },
    {
      id: 'chart-nodes',
      group: 'structure',
      order: 6,
      title: 'Complexité des sous-graphes',
      text: 'Répartition des événements selon la taille de leur sous-graphe local.'
    },
    {
      id: 'chart-edges',
      group: 'semantics',
      order: 7,
      title: 'Relations sémantiques dominantes',
      text: 'Types de liens les plus fréquents dans les sous-graphes extraits.'
    },
    {
      id: 'chart-labels',
      group: 'structure',
      order: 8,
      title: 'Labels de nœuds les plus fréquents',
      text: 'Catégories d’entités qui structurent le plus fortement le graphe.'
    }
  ];

  config.forEach(item => {
    const canvas = document.getElementById(item.id);
    const card = canvas?.closest('.chart-card');
    if (!card) return;

    card.dataset.group = item.group;
    card.style.order = String(item.order);
    card.style.minHeight = item.id === 'chart-scores' ? '320px' : '290px';

    const h3 = card.querySelector('h3');
    const p = card.querySelector('p');
    if (h3) h3.textContent = item.title;
    if (p) p.textContent = item.text;
  });

  const chartsGrid = document.getElementById('visu-charts');
  if (chartsGrid) {
    chartsGrid.style.alignItems = 'stretch';
    chartsGrid.style.gridAutoRows = 'minmax(290px, auto)';
    chartsGrid.style.gap = '1rem';
  }
}

function updateVisuStats() {
  const metrics = getDatasetMetrics();

  const statPairs = {
    'stat-total': metrics.totalEvents.toLocaleString('fr-FR'),
    'stat-anomalies': metrics.alertCount.toLocaleString('fr-FR'),
    'stat-quasi': metrics.quasiEventCount.toLocaleString('fr-FR'),
    'stat-articles': metrics.totalArticles.toLocaleString('fr-FR'),
    'stat-clusters': metrics.clusterCount.toLocaleString('fr-FR'),
    'visu-insight-alerts': `${metrics.criticalCount.toLocaleString('fr-FR')} critiques`,
    'visu-insight-links': `${metrics.quasiLinkCount.toLocaleString('fr-FR')} liens`,
    'visu-insight-density': `${metrics.avgNodesPerEvent.toFixed(1)} noeuds / event`,
    'visu-insight-coverage': `${Math.round(metrics.riskCoverage * 100)}% avec risk`,
    'visu-insight-types': topEntries(metrics.typeCounts, 1)[0]?.[0] || 'Inconnu'
  };

  Object.entries(statPairs).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const headerMeta = document.getElementById('visu-header-meta');
  if (headerMeta) {
    headerMeta.textContent =
      `${metrics.totalEvents.toLocaleString('fr-FR')} événements analysés, ` +
      `${metrics.totalArticles.toLocaleString('fr-FR')} articles reconstruits, ` +
      `${metrics.clusterCount.toLocaleString('fr-FR')} clusters exploitables et ` +
      `${metrics.quasiLinkCount.toLocaleString('fr-FR')} relations de quasi-doublon.`;
  }
}

function buildVisuCharts() {
  const emptyState = document.getElementById('visu-empty');
  const chartsGrid = document.getElementById('visu-charts');
  const events = state.events || [];

  destroyVisuCharts();
  bindTreemapControls();
  removeLegacyVisuSections();
  ensureVisuDashboardControls();
  enhanceVisuCardsContent();
  updateVisuStats();

  if (!events.length || typeof Chart === 'undefined') {
    if (emptyState) emptyState.style.display = 'block';
    if (chartsGrid) chartsGrid.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (chartsGrid) chartsGrid.style.display = 'grid';

  const metrics = getDatasetMetrics(events);
  const chartColors = [
    '#1bae9f', '#09a4e8', '#bd33d1', '#625eec', '#005f73',
    '#8412dd', '#ffa502', '#ff4757', '#2ed573', '#a29bfe'
  ];
  const tickColor = '#6b84a3';
  const gridColor = 'rgba(255,255,255,0.05)';
  const emptyColor = 'rgba(107,132,163,0.35)';
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false
  };

  Chart.defaults.color = tickColor;
  Chart.defaults.borderColor = gridColor;

  const axisFont = { family: 'Lexend', size: 9 };
  const legendFont = { family: 'Lexend', size: 10 };

  const typeEntries = topEntries(metrics.typeCounts, 10);
  registerVisuChart(new Chart(document.getElementById('chart-types'), {
    type: 'bar',
    data: {
      labels: typeEntries.length ? typeEntries.map(([label]) => label) : ['Aucune donnée'],
      datasets: [{
        data: typeEntries.length ? typeEntries.map(([, value]) => value) : [0],
        backgroundColor: typeEntries.length ? chartColors : [emptyColor],
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 32
      }]
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: tickColor, font: axisFont, autoSkip: false, maxRotation: 35, minRotation: 0 },
          grid: { color: 'rgba(255,255,255,0.02)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  }));

  const anomalyLevels = { Normal: 0, Suspect: 0, Critique: 0 };
  events.forEach(event => {
    const level = normalizeAnomalyLevel(event.anomaly?.niveau, event.anomaly?.is_anomaly);
    anomalyLevels[level] = (anomalyLevels[level] || 0) + 1;
  });
  const anomalyEntries = Object.entries(anomalyLevels);
  const hasAnomalyData = anomalyEntries.some(([, count]) => count > 0);

  registerVisuChart(new Chart(document.getElementById('chart-anomaly'), {
    type: 'doughnut',
    data: {
      labels: hasAnomalyData ? anomalyEntries.map(([label]) => label) : ['Aucune donnée'],
      datasets: [{
        data: hasAnomalyData ? anomalyEntries.map(([, count]) => count) : [1],
        backgroundColor: hasAnomalyData ? ['#2ed573', '#ffa502', '#ff4757'] : [emptyColor],
        borderWidth: 2,
        borderColor: '#0b1a30',
        hoverOffset: 6
      }]
    },
    options: {
      ...baseOptions,
      cutout: '66%',
      plugins: {
        legend: {
          position: 'top',
          labels: { color: tickColor, font: legendFont, boxWidth: 10, usePointStyle: true }
        }
      }
    }
  }));

  const histogram = buildHistogram(events.map(getEventAnomalyScore), 12, 0, 1);
  registerVisuChart(new Chart(document.getElementById('chart-scores'), {
    type: 'bar',
    data: {
      labels: histogram.map(bucket => bucket.label),
      datasets: [{
        label: 'Événements',
        data: histogram.map(bucket => bucket.value),
        backgroundColor: histogram.map((bucket, index) =>
          index >= 8 ? 'rgba(255,71,87,0.68)'
            : index >= 5 ? 'rgba(255,165,2,0.62)'
              : 'rgba(27,174,159,0.56)'
        ),
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 38
      }]
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: tickColor, font: axisFont, maxRotation: 0, minRotation: 0 },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  }));

  const articleAlerts = {};
  events.forEach(event => {
    const articleId = event.resultAnalyseId || 'unknown';
    const level = normalizeAnomalyLevel(event.anomaly?.niveau, event.anomaly?.is_anomaly);
    if (!articleAlerts[articleId]) articleAlerts[articleId] = { critique: 0, suspect: 0 };
    if (level === 'Critique') articleAlerts[articleId].critique += 1;
    else if (level === 'Suspect') articleAlerts[articleId].suspect += 1;
  });

  const rankedArticles = Object.entries(articleAlerts)
    .map(([id, values]) => ({ id, ...values, total: values.critique + values.suspect }))
    .filter(item => item.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.critique - a.critique;
    })
    .slice(0, 12);

  registerVisuChart(new Chart(document.getElementById('chart-article-alerts'), {
    type: 'bar',
    data: {
      labels: rankedArticles.length ? rankedArticles.map(article => article.id.slice(-8)) : ['Aucun article'],
      datasets: [
        {
          label: 'Critique',
          data: rankedArticles.length ? rankedArticles.map(article => article.critique) : [0],
          backgroundColor: rankedArticles.length ? 'rgba(255,71,87,0.74)' : emptyColor,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 30
        },
        {
          label: 'Suspect',
          data: rankedArticles.length ? rankedArticles.map(article => article.suspect) : [0],
          backgroundColor: rankedArticles.length ? 'rgba(255,165,2,0.66)' : emptyColor,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 30
        }
      ]
    },
    options: {
      ...baseOptions,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: tickColor, font: legendFont, boxWidth: 10, usePointStyle: true }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: tickColor, font: axisFont, maxRotation: 0, minRotation: 0 },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  }));

  const clusterCounts = {};
  events.forEach(event => {
    if (!event.clustering || event.clustering.is_noise || event.clustering.cluster_id === -1) return;
    const label = event.clustering.cluster_label || String(event.clustering.cluster_id);
    clusterCounts[label] = (clusterCounts[label] || 0) + 1;
  });
  const topClusters = topEntries(clusterCounts, 12);

  registerVisuChart(new Chart(document.getElementById('chart-clusters'), {
    type: 'bar',
    indexAxis: 'y',
    data: {
      labels: topClusters.length ? topClusters.map(([label]) => label) : ['Aucun cluster'],
      datasets: [{
        data: topClusters.length ? topClusters.map(([, value]) => value) : [0],
        backgroundColor: topClusters.length ? 'rgba(98,94,236,0.72)' : emptyColor,
        borderRadius: 7,
        borderSkipped: false
      }]
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        },
        y: {
          ticks: { color: tickColor, font: axisFont },
          grid: { color: 'rgba(255,255,255,0.03)' }
        }
      }
    }
  }));

  const nodeCountBuckets = { '0': 0, '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
  events.forEach(event => {
    const count = (event.nodes || []).length;
    if (count === 0) nodeCountBuckets['0']++;
    else if (count <= 2) nodeCountBuckets['1-2']++;
    else if (count <= 5) nodeCountBuckets['3-5']++;
    else if (count <= 10) nodeCountBuckets['6-10']++;
    else nodeCountBuckets['11+']++;
  });

  registerVisuChart(new Chart(document.getElementById('chart-nodes'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(nodeCountBuckets),
      datasets: [{
        data: Object.values(nodeCountBuckets),
        backgroundColor: chartColors.slice(0, 5),
        borderWidth: 2,
        borderColor: '#0b1a30',
        hoverOffset: 6
      }]
    },
    options: {
      ...baseOptions,
      cutout: '64%',
      plugins: {
        legend: {
          position: 'top',
          labels: { color: tickColor, font: legendFont, boxWidth: 10, usePointStyle: true }
        }
      }
    }
  }));

  const topEdges = topEntries(metrics.edgeTypeCounts, 10);
  registerVisuChart(new Chart(document.getElementById('chart-edges'), {
    type: 'bar',
    data: {
      labels: topEdges.length ? topEdges.map(([label]) => label) : ['Aucune relation'],
      datasets: [{
        data: topEdges.length ? topEdges.map(([, value]) => value) : [0],
        backgroundColor: topEdges.length ? 'rgba(9,164,232,0.68)' : emptyColor,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 30
      }]
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: tickColor, font: axisFont, maxRotation: 35, minRotation: 0 },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  }));

  const topLabels = topEntries(metrics.nodeLabelCounts, 10);
  registerVisuChart(new Chart(document.getElementById('chart-labels'), {
    type: 'bar',
    indexAxis: 'y',
    data: {
      labels: topLabels.length ? topLabels.map(([label]) => label) : ['Aucun label'],
      datasets: [{
        data: topLabels.length ? topLabels.map(([, value]) => value) : [0],
        backgroundColor: topLabels.length ? 'rgba(189,51,209,0.72)' : emptyColor,
        borderRadius: 7,
        borderSkipped: false
      }]
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: tickColor, font: axisFont, precision: 0 },
          grid: { color: gridColor }
        },
        y: {
          ticks: { color: tickColor, font: axisFont },
          grid: { color: 'rgba(255,255,255,0.03)' }
        }
      }
    }
  }));

  applyVisuCardFilters();

  state.visuChartsBuilt = true;
}