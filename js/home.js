const HOME_REPO_MODULES = [
  {
    eyebrow: 'EDA',
    title: 'Exploration & normalisation',
    text: 'Les notebooks du dossier EDA servent a lire les exports Mongo, normaliser les champs $oid / $date, reconstruire les sous-graphes et observer la distribution brute des evenements.',
    meta: 'EDA/intro_au_json.ipynb · EDA/reconstruction_de_contexte.ipynb'
  },
  {
    eyebrow: 'Axe 1',
    title: 'Scoring d anomalies',
    text: 'Le pipeline anomalies combine embeddings, features structurelles et taxonomie. Le score final est compose avec Isolation Forest et un score local de voisinage semantique.',
    meta: 'anomalies_similarite/anomalies.py · anomalies_similarite/marquage_anomalies.ipynb'
  },
  {
    eyebrow: 'Similarite',
    title: 'Quasi-doublons & fusion',
    text: 'Les scripts de similarite relient les events proches via embeddings MiniLM, score cosinus, fenetre temporelle et rapports de fusion ou de quasi-doublon.',
    meta: 'anomalies_similarite/deduplicate_events.py · anomalies_similarite/intra_cluster_doublons.py'
  },
  {
    eyebrow: 'Axe 2',
    title: 'Clustering des articles',
    text: 'Les articles sont reconstruits via resultAnalyseId, enrichis avec structure + taxonomie, puis projetes par UMAP et groupes par HDBSCAN avec labels TF-IDF.',
    meta: 'clusters/cluster_articles.py · app/dashboard_articles.html'
  },
  {
    eyebrow: 'Recherche',
    title: 'Comparaison de methodes',
    text: 'Une branche avancee compare HDBSCAN optimise, NMF topic modeling et Louvain sur graphe d entites partagees pour mesurer la qualite de regroupement.',
    meta: 'clusters/clustering_advanced.py · clusters/clustering_advanced.html'
  },
  {
    eyebrow: 'Beta',
    title: 'Correction des lieux',
    text: 'Le module de correction de lieux inspecte les coordonnees aberrantes, propose des corrections manuelles ou assistees et exporte un JSON corrige.',
    meta: 'app/location_fixer.html'
  }
];

const HOME_LAUNCHERS = [
  {
    title: 'Demo outil',
    text: 'Explorer le graphe, filtrer les articles, inspecter les anomalies et suivre les quasi-doublons.',
    actionLabel: 'Ouvrir le graphe',
    internalPage: 'demo'
  },
  {
    title: 'Visualisation',
    text: 'Voir les statistiques consolidees, la treemap interactive et les analyses reutilisees depuis le depot.',
    actionLabel: 'Voir les analyses',
    internalPage: 'visu'
  },
  {
    title: 'Correction lieux',
    text: 'Acceder au quatrieme onglet beta pour traiter les anomalies de geolocalisation.',
    actionLabel: 'Ouvrir le module',
    internalPage: 'location'
  },
  {
    title: 'Rapport technique',
    text: 'Consulter le rapport HTML complet avec la synthese projet, les choix methodologiques et les livrables.',
    actionLabel: 'Ouvrir le rapport',
    href: 'RAPPORT.html'
  }
];

const VISU_SOURCE_MODULES = [
  {
    title: 'Dashboard articles',
    text: 'Le dashboard article-level montre treemap, bubble chart et reconstruction par resultAnalyseId.',
    href: 'app/dashboard_articles.html'
  },
  {
    title: 'Dashboard clusters',
    text: 'Version centree sur les clusters d events, utile pour comparer avec la vue article.',
    href: 'app/dashboard_clusters.html'
  },
  {
    title: 'Explorer multi-graphes',
    text: 'Un autre explorateur vis-network present dans le depot, utile comme reference produit.',
    href: 'app/graph_explorer_multi.html'
  },
  {
    title: 'Clusters interactifs',
    text: 'Vue D3 sur les articles clusterises avec filtres et details de contexte.',
    href: 'clusters/cluster_interactive.html'
  }
];

function renderCardCollection(containerId, items, variant = 'repo') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = items.map(item => {
    const eyebrow = item.eyebrow
      ? `<div class="module-eyebrow">${item.eyebrow}</div>`
      : '';
    const meta = item.meta
      ? `<div class="module-meta">${item.meta}</div>`
      : '';
    const action = item.internalPage
      ? `<button class="module-action" type="button" onclick="showPage('${item.internalPage}')">${item.actionLabel}</button>`
      : item.href
        ? `<a class="module-action link" href="${item.href}" target="_blank" rel="noopener">${item.actionLabel || 'Ouvrir'}</a>`
        : '';

    return `
      <article class="module-card ${variant}">
        ${eyebrow}
        <h3>${item.title}</h3>
        <p>${item.text}</p>
        ${meta}
        ${action}
      </article>
    `;
  }).join('');
}

function updateHomeMetrics() {
  const metrics = getDatasetMetrics();
  const pairs = {
    'hero-total-events': metrics.totalEvents.toLocaleString('fr-FR'),
    'hero-total-articles': metrics.totalArticles.toLocaleString('fr-FR'),
    'hero-total-alerts': metrics.alertCount.toLocaleString('fr-FR'),
    'hero-total-clusters': metrics.clusterCount.toLocaleString('fr-FR'),
    'home-kpi-events': metrics.totalEvents.toLocaleString('fr-FR'),
    'home-kpi-articles': metrics.totalArticles.toLocaleString('fr-FR'),
    'home-kpi-critical': metrics.criticalCount.toLocaleString('fr-FR'),
    'home-kpi-links': metrics.quasiLinkCount.toLocaleString('fr-FR'),
    'home-metric-density': `${metrics.avgNodesPerEvent.toFixed(1)} noeuds / event`,
    'home-metric-coverage': `${Math.round(metrics.domainCoverage * 100)}% avec domaine`
  };

  Object.entries(pairs).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const heroSummary = document.getElementById('home-summary-line');
  if (heroSummary) {
    heroSummary.textContent = `${metrics.totalArticles.toLocaleString('fr-FR')} articles reconstruits, ${metrics.clusterCount.toLocaleString('fr-FR')} clusters actifs et ${metrics.quasiLinkCount.toLocaleString('fr-FR')} liens de quasi-doublons.`;
  }

  const heroSignal = document.getElementById('home-signal-line');
  if (heroSignal) {
    heroSignal.textContent = `${metrics.criticalCount.toLocaleString('fr-FR')} critiques, ${metrics.suspectCount.toLocaleString('fr-FR')} suspects, moyenne ${metrics.avgEdgesPerEvent.toFixed(1)} aretes par evenement.`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderCardCollection('home-repo-grid', HOME_REPO_MODULES, 'repo');
  renderCardCollection('home-launch-grid', HOME_LAUNCHERS, 'launch');
  renderCardCollection('visu-source-grid', VISU_SOURCE_MODULES, 'source');
  updateHomeMetrics();
});
