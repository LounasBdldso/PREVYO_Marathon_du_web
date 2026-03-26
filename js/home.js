const HOME_REPO_MODULES = [
  {
    eyebrow: 'EDA',
    title: 'Exploration & normalisation',
    text: 'Les notebooks du dossier EDA servent à lire les exports Mongo, normaliser les champs $oid / $date, reconstruire les sous-graphes et observer la distribution brute des événements.',
    meta: 'EDA/intro_au_json.ipynb · EDA/reconstruction_de_contexte.ipynb'
  },
  {
    eyebrow: 'Axe 1',
    title: 'Scoring d’anomalies',
    text: 'Le pipeline anomalies combine embeddings, features structurelles et taxonomie. Le score final est composé avec Isolation Forest et un score local de voisinage sémantique.',
    meta: 'anomalies_similarite/anomalies.py · anomalies_similarite/marquage_anomalies.ipynb'
  },
  {
    eyebrow: 'Similarité',
    title: 'Quasi-doublons & fusion',
    text: 'Les scripts de similarité relient les events proches via embeddings MiniLM, score cosinus, fenêtre temporelle et rapports de fusion ou de quasi-doublon.',
    meta: 'anomalies_similarite/deduplicate_events.py · anomalies_similarite/intra_cluster_doublons.py'
  },
  {
    eyebrow: 'Beta',
    title: 'Correction des lieux',
    text: 'Le module de correction de lieux inspecte les coordonnées aberrantes, propose des corrections manuelles ou assistées et exporte un JSON corrigé.',
    meta: 'app/location_fixer.html'
  }
];

function renderCardCollection(containerId, items, variant = 'repo') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = items.map(item => {
    const eyebrow = item.eyebrow ? `<div class="module-eyebrow">${item.eyebrow}</div>` : '';
    const meta = item.meta ? `<div class="module-meta">${item.meta}</div>` : '';

    return `
      <article class="module-card ${variant}">
        ${eyebrow}
        <h3>${item.title}</h3>
        <p>${item.text}</p>
        ${meta}
      </article>
    `;
  }).join('');
}

function updateHomeMetrics() {
  const metrics = getDatasetMetrics();

  const pairs = {
    'strip-events': metrics.totalEvents.toLocaleString('fr-FR'),
    'strip-articles': metrics.totalArticles.toLocaleString('fr-FR'),
    'strip-critical': metrics.criticalCount.toLocaleString('fr-FR'),
    'strip-links': metrics.quasiLinkCount.toLocaleString('fr-FR')
  };

  Object.entries(pairs).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = value;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderCardCollection('home-repo-grid', HOME_REPO_MODULES, 'repo');
  updateHomeMetrics();
});