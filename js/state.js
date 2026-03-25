// ═══════════════════════════════════════════════════════════
// STATE — état global partagé entre tous les modules
// ═══════════════════════════════════════════════════════════
const state = {
  events: [],
  articleMap: {},       // resultAnalyseId -> events[]
  articleIds: [],
  selectedIds: new Set(),
  currentView: 'selected',
  treemapBuilt: false,
  network: null,
  physicsOn: true,
  labelsOn: true,
  anomalyHighlight: true,
  currentNodes: null,
  currentEdges: null,
  visuChartsBuilt: false,
  maxNodes: 500,
  maxEdges: 1000
};

const ARTICLE_COLORS = [
  '#1bae9f', '#09a4e8', '#bd33d1', '#625eec', '#ffa502',
  '#ff6b81', '#2ed573', '#eccc68', '#a29bfe', '#fd79a8',
];
