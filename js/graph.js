// ═══════════════════════════════════════════════════════════
// GRAPH UTILITIES
// ═══════════════════════════════════════════════════════════
const NODE_TYPE_CONFIG = {
  event: { shape: 'diamond', size: 22, label: 'Événement' },
  time: { shape: 'triangle', size: 20, label: 'Temps' },
  person: { shape: 'hexagon', size: 21, label: 'Personne' },
  object: { shape: 'square', size: 20, label: 'Objet' },
  other: { shape: 'dot', size: 18, label: 'Autre' }
};

const ANOMALY_LEVEL_CONFIG = {
  Normal: {
    background: 'rgba(46,213,115,0.12)',
    border: '#2ed573',
    shadow: 'rgba(46,213,115,0.25)'
  },
  Suspect: {
    background: 'rgba(255,165,2,0.12)',
    border: '#ffa502',
    shadow: 'rgba(255,165,2,0.28)'
  },
  Critique: {
    background: 'rgba(255,71,87,0.14)',
    border: '#ff4757',
    shadow: 'rgba(255,71,87,0.32)'
  },
  Inconnu: {
    background: 'rgba(107,132,163,0.16)',
    border: '#6b84a3',
    shadow: null
  }
};

function normalizeId(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value.id) return String(value.id);
  }
  return String(value);
}

function canonicalize(properties) {
  if (!properties) return '{}';
  const sorted = Object.keys(properties).sort().reduce((acc, key) => {
    acc[key] = properties[key];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

function getEventId(event) {
  return normalizeId(event?._id) || `${event?.resultAnalyseId || 'unknown'}:${normalizeId(event?.sourceNodeId)}`;
}

function getEventAnomalyLevel(event) {
  return normalizeAnomalyLevel(event?.anomaly?.niveau, event?.anomaly?.is_anomaly);
}

function getNodeKind(labels) {
  const allLabels = Array.isArray(labels) ? labels : [];

  if (allLabels.some(label => label.includes('Event'))) return 'event';
  if (allLabels.some(label => label.includes('Time'))) return 'time';
  if (allLabels.some(label => label.includes('Human') || label.includes('Animate') || label.includes('Organization'))) return 'person';
  if (allLabels.some(label => label.includes('Inanimate') || label.includes('Product'))) return 'object';
  return 'other';
}

function getDominantAnomalyLevel(levelCounts) {
  const entries = Object.entries(levelCounts || {});
  if (!entries.length) return 'Inconnu';

  return entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return getAnomalyLevelRank(b[0]) - getAnomalyLevelRank(a[0]);
  })[0][0];
}

function getNodeVisualStyle(level, highlightEnabled = true) {
  if (!highlightEnabled) {
    return {
      background: 'rgba(107,132,163,0.18)',
      border: '#6b84a3',
      shadow: null,
      borderWidth: 1.8
    };
  }

  const palette = ANOMALY_LEVEL_CONFIG[level] || ANOMALY_LEVEL_CONFIG.Inconnu;
  return {
    background: palette.background,
    border: palette.border,
    shadow: palette.shadow,
    borderWidth: level === 'Normal' ? 2 : 3.2
  };
}

function getEventAnchorNode(event) {
  const nodes = event?.nodes || [];
  const sourceNodeId = normalizeId(event?.sourceNodeId);

  if (sourceNodeId) {
    const sourceNode = nodes.find(node => normalizeId(node._id) === sourceNodeId);
    if (sourceNode) return sourceNode;
  }

  const eventNode = nodes.find(node => (node.labels || []).some(label => label.includes('Event')));
  if (eventNode) return eventNode;

  return nodes[0] || null;
}

function buildGlobalNodeIndex(events) {
  const index = new Map();

  (events || []).forEach(event => {
    (event.nodes || []).forEach(node => {
      const nodeId = normalizeId(node._id);
      if (!nodeId || index.has(nodeId)) return;
      index.set(nodeId, { node, event });
    });
  });

  return index;
}

function buildNodeTitle(visNode) {
  const node = visNode._data?.node;
  const articles = visNode._data?.articleIds ? [...visNode._data.articleIds] : [];
  const dominantLevel = visNode._data?.dominantLevel || 'Inconnu';
  const baseLines = [
    node?.form || normalizeId(node?._id) || 'Sans libellé',
    (node?.labels || []).join(', '),
    `Type: ${NODE_TYPE_CONFIG[visNode._data?.kind || 'other'].label}`,
    `Niveau dominant: ${dominantLevel}`
  ];

  if (visNode._data?.events?.length > 1) {
    baseLines.push(`Occurrences fusionnées: ${visNode._data.events.length}`);
  }
  if (articles.length > 1) {
    baseLines.push(`Articles: ${articles.length}`);
  }

  return baseLines.filter(Boolean).join('\n');
}

function applyVisualStyleToNode(visNode, compact) {
  const kind = visNode._data?.kind || 'other';
  const typeConfig = NODE_TYPE_CONFIG[kind];
  const dominantLevel = getDominantAnomalyLevel(visNode._data?.levelCounts);
  const visualStyle = getNodeVisualStyle(dominantLevel, state.anomalyHighlight);
  const node = visNode._data?.node;

  visNode._data.dominantLevel = dominantLevel;
  visNode.shape = typeConfig.shape;
  visNode.size = typeConfig.size;
  visNode.label = (!state.labelsOn || compact)
    ? ''
    : String(node?.form || normalizeId(node?._id) || 'Sans libellé').slice(0, 20);
  visNode.title = buildNodeTitle(visNode);
  visNode.font = { color: '#dde8f5', size: 11, face: 'Lexend' };
  visNode.color = {
    background: visualStyle.background,
    border: visualStyle.border,
    highlight: { background: visualStyle.background, border: visualStyle.border },
    hover: { background: visualStyle.background, border: visualStyle.border }
  };
  visNode.borderWidth = visualStyle.borderWidth;
  visNode.shadow = visualStyle.shadow
    ? { enabled: true, color: visualStyle.shadow, size: dominantLevel === 'Critique' ? 12 : 8, x: 0, y: 0 }
    : false;
}

function addSemanticEdge(edgeMap, fromKey, toKey, edge, event, compact) {
  const key = `semantic:${fromKey}:${toKey}:${edge.type || ''}`;
  if (edgeMap.has(key)) {
    edgeMap.get(key)._data.occurrences += 1;
    return;
  }

  edgeMap.set(key, {
    id: key,
    from: fromKey,
    to: toKey,
    label: compact ? '' : (edge.type || ''),
    font: { size: 9, color: '#6b84a3', face: 'Lexend', align: 'middle' },
    color: { color: 'rgba(107,132,163,0.42)', highlight: '#1bae9f', hover: '#1bae9f' },
    width: 1.2,
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    smooth: { type: 'dynamic' },
    _data: {
      kind: 'semantic',
      edge,
      event,
      occurrences: 1
    }
  });
}

function addQuasiDuplicateEdge(quasiEdgeMap, fromKey, toKey, duplicate, event) {
  if (!fromKey || !toKey || fromKey === toKey) return;

  const [left, right] = [fromKey, toKey].sort();
  const key = `quasi:${left}:${right}`;
  const score = Number(duplicate.similarity_score || duplicate.cosine_similarity || 0);

  if (quasiEdgeMap.has(key)) {
    const existing = quasiEdgeMap.get(key);
    existing._data.occurrences += 1;
    existing._data.score = Math.max(existing._data.score, score);
    existing.width = Math.max(existing.width, 1.4 + Math.max(0, Math.min(2.8, (score - 0.85) * 10)));
    existing._data.matches.push({
      duplicateOf: duplicate.duplicate_of,
      similarity: score,
      cosine: Number(duplicate.cosine_similarity || 0)
    });
    return;
  }

  quasiEdgeMap.set(key, {
    id: key,
    from: left,
    to: right,
    label: '',
    font: { size: 8, color: '#ffd166', face: 'Lexend', align: 'middle' },
    color: { color: 'rgba(255,165,2,0.95)', highlight: '#ffd166', hover: '#ffd166' },
    width: 1.4 + Math.max(0, Math.min(2.8, (score - 0.85) * 10)),
    dashes: [8, 6],
    arrows: {
      to: { enabled: false },
      from: { enabled: false },
      middle: { enabled: false }
    },
    smooth: { type: 'curvedCW', roundness: 0.16 },
    physics: false,
    _data: {
      kind: 'quasi',
      edge: { type: 'Quasi-duplicate' },
      event,
      occurrences: 1,
      score,
      matches: [{
        duplicateOf: duplicate.duplicate_of,
        similarity: score,
        cosine: Number(duplicate.cosine_similarity || 0)
      }]
    }
  });
}

// ═══════════════════════════════════════════════════════════
// GRAPH BUILDING
// ═══════════════════════════════════════════════════════════
function buildGraphData() {
  const ids = state.currentView === 'merged' ? state.articleIds : [...state.selectedIds];
  if (!ids.length) return null;

  const events = [];
  ids.forEach(id => (state.articleMap[id] || []).forEach(event => events.push(event)));

  const MAX_NODES = state.currentView === 'merged' ? state.maxNodes : 500;
  const MAX_EDGES = state.currentView === 'merged' ? state.maxEdges : 1000;
  const compact = events.length > 50 || (state.currentView === 'merged' && (events.length > 20 || state.maxNodes < 400));

  const nodeMap = {};
  const semanticEdgeMap = new Map();
  const quasiEdgeMap = new Map();
  const articleNodeMap = {};
  const eventAnchorById = {};
  const globalNodeIndex = buildGlobalNodeIndex(state.events || []);

  function nodeKey(node, event, options = {}) {
    const rawId = normalizeId(node._id) || node.form || Math.random().toString(36).slice(2);
    if (state.currentView !== 'merged') {
      if (options.external) return `${rawId}__external`;
      return `${rawId}_${event.resultAnalyseId || 'unknown'}`;
    }
    return `${node.form || rawId}__${[...(node.labels || [])].sort().join('|')}__${canonicalize(node.properties)}`;
  }

  function ensureNode(node, carrierEvent, options = {}) {
    if (!node) return null;

    const ownerEvent = options.ownerEvent || carrierEvent;
    const articleId = ownerEvent?.resultAnalyseId || carrierEvent?.resultAnalyseId || 'unknown';
    const level = getEventAnomalyLevel(ownerEvent || carrierEvent);
    const key = nodeKey(node, carrierEvent, options);

    if (!nodeMap[key]) {
      nodeMap[key] = {
        id: key,
        _data: {
          key,
          node,
          event: ownerEvent || carrierEvent,
          events: [],
          articleIds: new Set(),
          rawNodeIds: new Set(),
          levelCounts: {},
          kind: getNodeKind(node.labels),
          external: Boolean(options.external)
        }
      };
    }

    const meta = nodeMap[key]._data;
    meta.events.push(ownerEvent || carrierEvent);
    meta.articleIds.add(articleId);
    meta.rawNodeIds.add(normalizeId(node._id));
    meta.levelCounts[level] = (meta.levelCounts[level] || 0) + 1;

    if (!options.external) {
      if (!articleNodeMap[articleId]) articleNodeMap[articleId] = [];
      articleNodeMap[articleId].push(key);
    }

    return key;
  }

  function resolveNodeByReference(event, refId) {
    if (!refId) return null;

    const localNode = (event.nodes || []).find(node => normalizeId(node._id) === refId);
    if (localNode) return { node: localNode, event, external: false };

    const globalMatch = globalNodeIndex.get(refId);
    if (globalMatch) return { ...globalMatch, external: true };

    return null;
  }

  events.forEach(event => {
    const articleId = event.resultAnalyseId || 'unknown';
    if (!articleNodeMap[articleId]) articleNodeMap[articleId] = [];

    const anchorNode = getEventAnchorNode(event);
    if (anchorNode) {
      eventAnchorById[getEventId(event)] = ensureNode(anchorNode, event) || nodeKey(anchorNode, event);
    }

    (event.nodes || []).forEach(node => {
      ensureNode(node, event);
    });

    (event.edges || []).forEach(edge => {
      const sourceId = normalizeId(edge.source);
      const targetId = normalizeId(edge.target);
      const sourceRef = resolveNodeByReference(event, sourceId);
      const targetRef = resolveNodeByReference(event, targetId);

      if (!sourceRef || !targetRef) {
        console.warn('Arête ignorée: source/target introuvable', {
          edge,
          availableNodeIds: (event.nodes || []).map(node => normalizeId(node._id))
        });
        return;
      }

      const fromKey = ensureNode(sourceRef.node, event, {
        external: sourceRef.external,
        ownerEvent: sourceRef.event
      });
      const toKey = ensureNode(targetRef.node, event, {
        external: targetRef.external,
        ownerEvent: targetRef.event
      });

      addSemanticEdge(
        semanticEdgeMap,
        fromKey,
        toKey,
        edge,
        event,
        compact
      );
    });
  });

  events.forEach(event => {
    const fromKey = eventAnchorById[getEventId(event)];
    if (!fromKey) return;

    (event.quasi_duplicates || []).forEach(duplicate => {
      const toKey = eventAnchorById[normalizeId(duplicate.duplicate_of)];
      addQuasiDuplicateEdge(quasiEdgeMap, fromKey, toKey, duplicate, event);
    });
  });

  let visNodes = Object.values(nodeMap);
  visNodes.forEach(node => applyVisualStyleToNode(node, compact));

  let visEdges = [
    ...semanticEdgeMap.values(),
    ...quasiEdgeMap.values()
  ];

  if (visNodes.length > MAX_NODES) {
    const degreeMap = {};
    visEdges.forEach(edge => {
      degreeMap[edge.from] = (degreeMap[edge.from] || 0) + 1;
      degreeMap[edge.to] = (degreeMap[edge.to] || 0) + 1;
    });

    const sortedNodes = visNodes.slice().sort((a, b) => {
      const aLevel = getAnomalyRank(a._data?.dominantLevel);
      const bLevel = getAnomalyRank(b._data?.dominantLevel);
      const aScore = aLevel * 1000 + (degreeMap[a.id] || 0);
      const bScore = bLevel * 1000 + (degreeMap[b.id] || 0);
      return bScore - aScore;
    });

    const keptNodeIds = new Set(sortedNodes.slice(0, MAX_NODES).map(node => node.id));
    visNodes = visNodes.filter(node => keptNodeIds.has(node.id));
    visEdges = visEdges.filter(edge => keptNodeIds.has(edge.from) && keptNodeIds.has(edge.to));
  }

  if (visEdges.length > MAX_EDGES) {
    const quasiEdges = visEdges.filter(edge => edge._data?.kind === 'quasi');
    const semanticEdges = visEdges.filter(edge => edge._data?.kind !== 'quasi');
    const remainingSlots = Math.max(0, MAX_EDGES - quasiEdges.length);
    visEdges = [...quasiEdges, ...semanticEdges.slice(0, remainingSlots)].slice(0, MAX_EDGES);
  }

  return { visNodes, visEdges, articleNodeMap, ids };
}

function refreshGraphLayout({ fit = false } = {}) {
  if (!state.network) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!state.network) return;
      state.network.redraw();
      if (fit) {
        state.network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
      }
      updateArticleBubbles();
    });
  });
}

function syncGraphNodeStyles() {
  if (!state.network || !state.currentNodes?.data?.length) return;

  const compact = state.currentNodes.data.length > 220;
  const updates = state.currentNodes.data.map(node => {
    applyVisualStyleToNode(node, compact);
    return {
      id: node.id,
      shape: node.shape,
      size: node.size,
      label: node.label,
      title: node.title,
      color: node.color,
      borderWidth: node.borderWidth,
      shadow: node.shadow
    };
  });

  state.network.body.data.nodes.update(updates);
  refreshGraphLayout();
}

function resetGraphView() {
  if (state.network) {
    state.network.destroy();
    state.network = null;
  }

  state.currentNodes = null;
  state.currentEdges = null;
  state.currentGraphMeta = null;

  const container = document.getElementById('graph-canvas');
  const bubbles = document.getElementById('article-bubbles');
  const placeholder = document.getElementById('graph-placeholder');

  if (container) container.innerHTML = '';
  if (bubbles) bubbles.innerHTML = '';
  if (placeholder) placeholder.style.display = 'flex';

  ['gs-nodes', 'gs-edges', 'gs-articles'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = '0';
  });

  if (typeof closeInspect === 'function') closeInspect();
}

// ═══════════════════════════════════════════════════════════
// GENERATE + RENDER GRAPH
// ═══════════════════════════════════════════════════════════
function generateGraph() {
  if (!state.events.length) {
    alert('Chargez un fichier JSON d\'abord.');
    return;
  }

  if (state.currentView === 'selected' && !state.selectedIds.size) {
    alert('Sélectionnez au moins un article.');
    return;
  }

  const data = buildGraphData();
  if (!data) return;

  const { visNodes, visEdges, articleNodeMap, ids } = data;

  document.getElementById('graph-placeholder').style.display = 'none';
  document.getElementById('gs-nodes').textContent = visNodes.length;
  document.getElementById('gs-edges').textContent = visEdges.length;
  document.getElementById('gs-articles').textContent = ids.length;

  state.currentNodes = { data: visNodes, map: {} };
  state.currentEdges = { data: visEdges };
  state.currentGraphMeta = { articleNodeMap, ids };
  visNodes.forEach(node => { state.currentNodes.map[node.id] = node; });

  const container = document.getElementById('graph-canvas');
  container.innerHTML = '';

  const dataset = {
    nodes: new vis.DataSet(visNodes),
    edges: new vis.DataSet(visEdges)
  };

  const options = {
    physics: {
      enabled: state.physicsOn,
      stabilization: { iterations: 160 },
      barnesHut: { gravitationalConstant: -2600, springLength: 118, damping: 0.42 }
    },
    interaction: { hover: true, tooltipDelay: 180, navigationButtons: false, keyboard: false },
    nodes: {
      scaling: { min: 12, max: 30 },
      shapeProperties: { borderDashes: false }
    },
    edges: {
      smooth: { type: 'dynamic' },
      selectionWidth: 2
    },
    layout: { randomSeed: 42 }
  };

  container.style.height = '100%';
  container.style.minHeight = '0';

  if (state.network) state.network.destroy();
  state.network = new vis.Network(container, dataset, options);

  refreshGraphLayout({ fit: true });

  state.network.on('click', params => {
    if (params.nodes.length > 0) inspectNode(params.nodes[0], state.currentNodes.map);
    else if (params.edges.length > 0) inspectEdge(params.edges[0], visEdges);
    else closeInspect();
  });
}

// ═══════════════════════════════════════════════════════════
// ARTICLE BUBBLES
// ═══════════════════════════════════════════════════════════
function updateArticleBubbles() {
  const bubblesDiv = document.getElementById('article-bubbles');
  if (bubblesDiv) bubblesDiv.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════
// GRAPH CONTROLS
// ═══════════════════════════════════════════════════════════
function graphFit() {
  if (!state.network) return;
  state.network.fit({ animation: true });
  setTimeout(() => refreshGraphLayout(), 200);
}

function graphStabilize() {
  if (!state.network) return;
  state.network.stabilize(100);
  setTimeout(() => refreshGraphLayout(), 150);
}

function togglePhysics() {
  state.physicsOn = !state.physicsOn;
  document.getElementById('ctrl-physics').classList.toggle('on', state.physicsOn);
  if (state.network) state.network.setOptions({ physics: { enabled: state.physicsOn } });
}

function toggleLabels() {
  state.labelsOn = !state.labelsOn;
  document.getElementById('ctrl-labels').classList.toggle('on', state.labelsOn);

  if (state.network && state.currentNodes) {
    const compact = state.currentNodes.data.length > 220;
    const updates = state.currentNodes.data.map(node => {
      applyVisualStyleToNode(node, compact);
      return { id: node.id, label: node.label, title: node.title };
    });
    state.network.body.data.nodes.update(updates);
  }
}

function toggleAnomalyHighlight() {
  state.anomalyHighlight = !state.anomalyHighlight;
  document.getElementById('ctrl-anomaly-highlight').classList.toggle('on', state.anomalyHighlight);
  syncGraphNodeStyles();
}

function updateRangeLabels() {
  const nodeRange = document.getElementById('max-nodes-range');
  const edgeRange = document.getElementById('max-edges-range');
  if (!nodeRange || !edgeRange) return;

  state.maxNodes = Number(nodeRange.value);
  state.maxEdges = Number(edgeRange.value);
  document.getElementById('max-nodes-value').textContent = `${state.maxNodes} sommets`;
  document.getElementById('max-edges-value').textContent = `${state.maxEdges} arêtes`;
}

function toggleSummary(kind) {
  const content = document.getElementById(`${kind}-content`);
  const toggle = document.getElementById(`${kind}-toggle`);
  if (!content || !toggle) return;
  content.classList.toggle('visible');
  toggle.classList.toggle('open');
}

window.addEventListener('resize', () => {
  if (!document.getElementById('page-demo')?.classList.contains('active')) return;
  refreshGraphLayout();
});