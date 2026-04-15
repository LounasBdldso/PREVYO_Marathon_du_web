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
    maxEdges: 1000,
    articleDropdownOpen: false
};

const ARTICLE_COLORS = [
    '#1bae9f', '#09a4e8', '#bd33d1', '#625eec', '#ffa502',
    '#ff6b81', '#2ed573', '#eccc68', '#a29bfe', '#fd79a8',
];


function normalizeAnomalyLevel(level, isAnomaly = false) {
    if (level === 'Critique' || level === 'Anomalie') return 'Critique';
    if (level === 'Suspect') return 'Suspect';
    if (level === 'Normal') return 'Normal';
    return isAnomaly ? 'Critique' : 'Normal';
}

function isElevatedAnomaly(level, isAnomaly = false) {
    const normalized = normalizeAnomalyLevel(level, isAnomaly);
    return normalized === 'Critique' || normalized === 'Suspect';
}

function getAnomalyLevelRank(level, isAnomaly = false) {
    const normalized = normalizeAnomalyLevel(level, isAnomaly);
    if (normalized === 'Critique') return 3;
    if (normalized === 'Suspect') return 2;
    if (normalized === 'Normal') return 1;
    return 0;
}

function formatCompactCount(value) {
    if (!Number.isFinite(value)) return '0';
    return new Intl.NumberFormat('fr-FR', {
        notation: 'compact',
        maximumFractionDigits: value >= 100 ? 0 : 1
    }).format(value);
}

function getDatasetMetrics(events = state.events || []) {
    const articleIds = new Set();
    const clusters = new Set();
    const clusterLabels = new Set();
    const types = new Map();
    const domains = new Map();
    const edgeTypes = new Map();
    const nodeLabels = new Map();

    let criticalCount = 0;
    let suspectCount = 0;
    let quasiEventCount = 0;
    let quasiLinkCount = 0;
    let totalNodes = 0;
    let totalEdges = 0;
    let riskCount = 0;
    let subdomainCount = 0;
    let domainCount = 0;

    events.forEach(event => {
        const articleId = event.resultAnalyseId || 'unknown';
        articleIds.add(articleId);

        const level = normalizeAnomalyLevel(event.anomaly?.niveau, event.anomaly?.is_anomaly);
        if (level === 'Critique') criticalCount++;
        else if (level === 'Suspect') suspectCount++;

        const quasiDuplicates = event.quasi_duplicates || [];
        if (quasiDuplicates.length > 0) {
            quasiEventCount++;
            quasiLinkCount += quasiDuplicates.length;
        }

        if (event.risk) riskCount++;
        if (event.subdomain) subdomainCount++;
        if (event.domain) domainCount++;

        const nodes = event.nodes || [];
        const edges = event.edges || [];
        totalNodes += nodes.length;
        totalEdges += edges.length;

        const typeLabel = String(event.type || 'Inconnu').split('/').filter(Boolean).slice(-2).join('/') || 'Inconnu';
        types.set(typeLabel, (types.get(typeLabel) || 0) + 1);

        const domainLabel = String(event.domain || 'Non renseigne');
        domains.set(domainLabel, (domains.get(domainLabel) || 0) + 1);

        edges.forEach(edge => {
            const edgeType = String(edge.type || 'Non renseigne').split('/').filter(Boolean).slice(-1)[0] || 'Non renseigne';
            edgeTypes.set(edgeType, (edgeTypes.get(edgeType) || 0) + 1);
        });

        nodes.forEach(node => {
            (node.labels || []).forEach(label => {
                const shortLabel = String(label).split('/').filter(Boolean).slice(-1)[0] || 'Inconnu';
                nodeLabels.set(shortLabel, (nodeLabels.get(shortLabel) || 0) + 1);
            });
        });

        const cluster = event.clustering || {};
        if (cluster.cluster_id != null && cluster.cluster_id !== -1 && !cluster.is_noise) {
            clusters.add(cluster.cluster_id);
        }
        if (cluster.cluster_label && !cluster.is_noise) {
            clusterLabels.add(cluster.cluster_label);
        }
    });

    return {
        totalEvents: events.length,
        totalArticles: articleIds.size,
        criticalCount,
        suspectCount,
        alertCount: criticalCount + suspectCount,
        quasiEventCount,
        quasiLinkCount,
        clusterCount: clusters.size,
        clusterLabelCount: clusterLabels.size,
        totalNodes,
        totalEdges,
        avgNodesPerEvent: events.length ? totalNodes / events.length : 0,
        avgEdgesPerEvent: events.length ? totalEdges / events.length : 0,
        riskCoverage: events.length ? riskCount / events.length : 0,
        subdomainCoverage: events.length ? subdomainCount / events.length : 0,
        domainCoverage: events.length ? domainCount / events.length : 0,
        typeCounts: types,
        domainCounts: domains,
        edgeTypeCounts: edgeTypes,
        nodeLabelCounts: nodeLabels
    };
}
