// ═══════════════════════════════════════════════════════════
// VISUALISATION — STATS
// ═══════════════════════════════════════════════════════════
function updateVisuStats() {
  const evts = state.events;
  document.getElementById('stat-total').textContent = evts.length.toLocaleString();
  document.getElementById('stat-anomalies').textContent = evts.filter(e => e.anomaly?.is_anomaly).length;
  document.getElementById('stat-quasi').textContent = evts.filter(e => (e.quasi_duplicates || []).length > 0).length;
  document.getElementById('stat-articles').textContent = Object.keys(state.articleMap).length;
  const clusters = new Set(evts.filter(e => e.clustering && !e.clustering.is_noise).map(e => e.clustering.cluster_id));
  document.getElementById('stat-clusters').textContent = clusters.size;
}

// ═══════════════════════════════════════════════════════════
// VISUALISATION — CHARTS
// ═══════════════════════════════════════════════════════════
function buildVisuCharts() {
  if (state.visuChartsBuilt) return;
  state.visuChartsBuilt = true;

  document.getElementById('visu-empty').style.display = 'none';
  document.getElementById('visu-charts').style.display = 'grid';

  const evts = state.events;
  const chartColors = [
    '#1bae9f', '#09a4e8', '#bd33d1', '#625eec', '#005f73',
    '#8412dd', '#ffa502', '#ff4757', '#2ed573', '#a29bfe'
  ];

  // Appliquer les defaults Chart.js sombres
  Chart.defaults.color = '#6b84a3';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';

  // 1. Types d'événements — Top 10
  const typeCounts = {};
  evts.forEach(e => {
    const t = (e.type || 'unknown').split('/').slice(-2).join('/');
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  new Chart(document.getElementById('chart-types'), {
    type: 'bar',
    data: {
      labels: topTypes.map(t => t[0]),
      datasets: [{ data: topTypes.map(t => t[1]), backgroundColor: chartColors, borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });

  // 2. Distribution des niveaux d'anomalie
  const niveaux = { Normal: 0, Suspect: 0, Anomalie: 0 };
  evts.forEach(e => {
    if (e.anomaly) {
      const n = e.anomaly.niveau;
      if (niveaux[n] !== undefined) niveaux[n]++;
      else niveaux.Anomalie++;
    }
  });
  new Chart(document.getElementById('chart-anomaly'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(niveaux),
      datasets: [{
        data: Object.values(niveaux),
        backgroundColor: ['#2ed573', '#ffa502', '#ff4757'],
        borderWidth: 2,
        borderColor: '#0b1a30'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#6b84a3', font: { family: 'Lexend', size: 10 } } } }
    }
  });

  // 3. Score d'anomalie moyen par article (30 premiers)
  const artScores = {};
  evts.forEach(e => {
    if (!e.resultAnalyseId || !e.anomaly) return;
    if (!artScores[e.resultAnalyseId]) artScores[e.resultAnalyseId] = [];
    artScores[e.resultAnalyseId].push(e.anomaly.score);
  });
  const artIds = Object.keys(artScores).slice(0, 30);
  const avgScores = artIds.map(id => {
    const s = artScores[id];
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  const anomalyThreshold = 0.5;
  new Chart(document.getElementById('chart-scores'), {
    type: 'bar',
    data: {
      labels: artIds.map(id => id.slice(-8)),
      datasets: [{
        data: avgScores,
        backgroundColor: avgScores.map(s => s > anomalyThreshold ? 'rgba(255,71,87,0.7)' : 'rgba(27,174,159,0.6)'),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 8 }, maxRotation: 60 }, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { min: 0, max: 1, ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });

  // 4. Distribution des clusters — Top 15
  const clusterCounts = {};
  evts.forEach(e => {
    if (!e.clustering || e.clustering.is_noise) return;
    const lbl = e.clustering.cluster_label || String(e.clustering.cluster_id);
    clusterCounts[lbl] = (clusterCounts[lbl] || 0) + 1;
  });
  const topClusters = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  new Chart(document.getElementById('chart-clusters'), {
    type: 'bar',
    indexAxis: 'y',
    data: {
      labels: topClusters.map(c => c[0]),
      datasets: [{ data: topClusters.map(c => c[1]), backgroundColor: 'rgba(98,94,236,0.65)', borderRadius: 4, borderSkipped: false }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#6b84a3', font: { family: 'Lexend', size: 9 } }, grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    }
  });

  // 5. Nombre de nœuds par événement (distribution)
  const nodeCountBuckets = { '0': 0, '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
  evts.forEach(e => {
    const c = (e.nodes || []).length;
    if      (c === 0)  nodeCountBuckets['0']++;
    else if (c <= 2)   nodeCountBuckets['1-2']++;
    else if (c <= 5)   nodeCountBuckets['3-5']++;
    else if (c <= 10)  nodeCountBuckets['6-10']++;
    else               nodeCountBuckets['11+']++;
  });
  new Chart(document.getElementById('chart-nodes'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(nodeCountBuckets),
      datasets: [{ data: Object.values(nodeCountBuckets), backgroundColor: chartColors.slice(0, 5), borderWidth: 2, borderColor: '#0b1a30' }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#6b84a3', font: { family: 'Lexend', size: 10 } } } }
    }
  });

  // Initialiser les contrôles du treemap (binding unique)
  const treemapField  = document.getElementById('treemap-field');
  const treemapSearch = document.getElementById('treemap-search');
  const treemapReset  = document.getElementById('treemap-reset');

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
      if (treemapSvg && treemapZoom) {
        treemapSvg.transition().duration(600).call(treemapZoom.transform, d3.zoomIdentity);
      }
    });
    treemapReset.dataset.bound = '1';
  }

  buildTreemap();
}
