// ═══════════════════════════════════════════════════════════
// GRAPH UTILITIES
// ═══════════════════════════════════════════════════════════
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
  const sorted = Object.keys(properties).sort().reduce((acc, k) => { acc[k] = properties[k]; return acc; }, {});
  return JSON.stringify(sorted);
}

function getNodeColor(labels, isAnomaly, isQuasi) {
  if (!labels || !labels.length) {
    return { bg: 'rgba(107,132,163,0.22)', border: '#8899aa', accentBorder: '#8899aa', font: '#dde8f5', shadow: null };
  }

  const l = labels[0];
  let baseBorder = '#8899aa';
  let baseBg = 'rgba(107,132,163,0.22)';

  if (l.includes('Event'))                           { baseBg = 'rgba(27,174,159,0.22)';  baseBorder = '#1bae9f'; }
  else if (l.includes('Time'))                       { baseBg = 'rgba(9,164,232,0.22)';   baseBorder = '#09a4e8'; }
  else if (l.includes('Human') || l.includes('Animate'))   { baseBg = 'rgba(189,51,209,0.22)';  baseBorder = '#bd33d1'; }
  else if (l.includes('Inanimate') || l.includes('Product')){ baseBg = 'rgba(98,94,236,0.22)';   baseBorder = '#625eec'; }

  let accentBorder = baseBorder;
  let shadow = null;

  if (isAnomaly && isQuasi) { accentBorder = '#ffffff'; shadow = 'rgba(255,255,255,0.35)'; }
  else if (isAnomaly)       { accentBorder = '#ff4757'; shadow = 'rgba(255,71,87,0.35)'; }
  else if (isQuasi)         { accentBorder = '#ffa502'; shadow = 'rgba(255,165,2,0.35)'; }

  return { bg: baseBg, border: baseBorder, accentBorder, font: '#dde8f5', shadow };
}

// ═══════════════════════════════════════════════════════════
// GRAPH BUILDING
// ═══════════════════════════════════════════════════════════
function buildGraphData() {
  const ids = state.currentView === 'merged' ? state.articleIds : [...state.selectedIds];
  if (!ids.length) return null;

  const events = [];
  ids.forEach(id => (state.articleMap[id] || []).forEach(e => events.push(e)));

  const MAX_NODES = state.currentView === 'merged' ? state.maxNodes : 500;
  const MAX_EDGES = state.currentView === 'merged' ? state.maxEdges : 1000;
  const compact = events.length > 50 || (state.currentView === 'merged' && (events.length > 20 || state.maxNodes < 400));

  const nodeMap = {};
  const edgeSet = new Set();
  const visNodes = [];
  const visEdges = [];
  const articleNodeMap = {};

  function nodeKey(n, ev) {
    const rawId = normalizeId(n._id) || n.form || Math.random().toString(36).slice(2);
    if (state.currentView !== 'merged') return `${rawId}_${ev.resultAnalyseId || 'unknown'}`;
    return `${n.form || rawId}__${[...(n.labels || [])].sort().join('|')}__${canonicalize(n.properties)}`;
  }

  events.forEach(ev => {
    const aid = ev.resultAnalyseId || 'unknown';
    const isAnomaly = ev.anomaly?.is_anomaly === true;
    const isQuasi = (ev.quasi_duplicates?.length > 0);

    if (!articleNodeMap[aid]) articleNodeMap[aid] = [];

    (ev.nodes || []).forEach(n => {
      const key = nodeKey(n, ev);
      if (!nodeMap[key]) {
        const col = getNodeColor(n.labels, isAnomaly, isQuasi);
        const visNode = {
          id: key,
          label: compact ? '' : String(n.form || normalizeId(n._id)).slice(0, 20),
          title: `${n.form}\n${(n.labels || []).join(', ')}`,
          color: {
            background: col.bg, border: col.accentBorder,
            highlight: { background: col.bg, border: col.accentBorder }
          },
          font: { color: col.font || '#dde8f5', size: 11, face: 'Lexend' },
          size: 16,
          borderWidth: (isAnomaly || isQuasi) ? 4 : 1.8,
          _data: { node: n, event: ev, key }
        };
        if ((isAnomaly || isQuasi) && state.anomalyHighlight && col.shadow) {
          visNode.shadow = { enabled: true, color: col.shadow, size: 10, x: 0, y: 0 };
        }
        nodeMap[key] = visNode;
        visNodes.push(visNode);
      }
      articleNodeMap[aid].push(key);
    });

    (ev.edges || []).forEach(edge => {
      const srcId = normalizeId(edge.source);
      const tgtId = normalizeId(edge.target);
      const srcN = (ev.nodes || []).find(n => normalizeId(n._id) === srcId);
      const tgtN = (ev.nodes || []).find(n => normalizeId(n._id) === tgtId);

      if (!srcN || !tgtN) {
        console.warn('Arête ignorée: source/target introuvable', { edge, availableNodeIds: (ev.nodes || []).map(n => normalizeId(n._id)) });
        return;
      }

      const srcKey = nodeKey(srcN, ev);
      const tgtKey = nodeKey(tgtN, ev);
      const eKey = srcKey + '>' + tgtKey + ':' + edge.type;
      if (!edgeSet.has(eKey)) {
        edgeSet.add(eKey);
        visEdges.push({
          from: srcKey, to: tgtKey,
          label: compact ? '' : (edge.type || ''),
          font: { size: 9, color: '#6b84a3', face: 'Lexend', align: 'middle' },
          color: { color: 'rgba(107,132,163,0.4)', highlight: '#1bae9f' },
          width: 1.2,
          arrows: { to: { enabled: true, scaleFactor: 0.5 } },
          _data: { edge, event: ev }
        });
      }
    });
  });

  // Élagage si trop grand
  let finalNodes = visNodes, finalEdges = visEdges;
  if (visNodes.length > MAX_NODES) {
    const degMap = {};
    visEdges.forEach(e => {
      degMap[e.from] = (degMap[e.from] || 0) + 1;
      degMap[e.to] = (degMap[e.to] || 0) + 1;
    });
    const sorted = visNodes.slice().sort((a, b) => {
      const aA = a._data?.event?.anomaly?.is_anomaly ? 10000 : 0;
      const bA = b._data?.event?.anomaly?.is_anomaly ? 10000 : 0;
      return (bA + (degMap[b.id] || 0)) - (aA + (degMap[a.id] || 0));
    });
    const kept = new Set(sorted.slice(0, MAX_NODES).map(n => n.id));
    finalNodes = visNodes.filter(n => kept.has(n.id));
    finalEdges = visEdges.filter(e => kept.has(e.from) && kept.has(e.to));
  }
  if (finalEdges.length > MAX_EDGES) finalEdges = finalEdges.slice(-MAX_EDGES);

  return { visNodes: finalNodes, visEdges: finalEdges, articleNodeMap, ids };
}

// ═══════════════════════════════════════════════════════════
// GENERATE + RENDER GRAPH
// ═══════════════════════════════════════════════════════════
function generateGraph() {
  if (!state.events.length) { alert('Chargez un fichier JSON d\'abord.'); return; }
  if (state.currentView === 'selected' && !state.selectedIds.size) { alert('Sélectionnez au moins un article.'); return; }

  const data = buildGraphData();
  if (!data) return;

  const { visNodes, visEdges, articleNodeMap, ids } = data;

  console.log('Graph data:', { articles: ids.length, nodes: visNodes.length, edges: visEdges.length, sampleNode: visNodes[0], sampleEdge: visEdges[0] });

  document.getElementById('graph-placeholder').style.display = 'none';
  document.getElementById('gs-nodes').textContent = visNodes.length;
  document.getElementById('gs-edges').textContent = visEdges.length;
  document.getElementById('gs-articles').textContent = ids.length;

  state.currentNodes = { data: visNodes, map: {} };
  visNodes.forEach(n => state.currentNodes.map[n.id] = n);

  const container = document.getElementById('graph-canvas');
  container.innerHTML = '';

  const dataset = {
    nodes: new vis.DataSet(visNodes),
    edges: new vis.DataSet(visEdges)
  };

  const options = {
    physics: {
      enabled: state.physicsOn,
      stabilization: { iterations: 150 },
      barnesHut: { gravitationalConstant: -3000, springLength: 120, damping: 0.4 }
    },
    interaction: { hover: true, tooltipDelay: 200, navigationButtons: false, keyboard: false },
    nodes: { shape: 'dot', scaling: { min: 10, max: 24 } },
    edges: { smooth: { type: 'dynamic' } },
    layout: { randomSeed: 42 }
  };

  container.style.height = '100%';
  container.style.minHeight = '0';

  if (state.network) state.network.destroy();
  state.network = new vis.Network(container, dataset, options);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.network.redraw();
      state.network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
      console.log('Container size after redraw:', { width: container.clientWidth, height: container.clientHeight });
    });
  });

  // Bulles articles (2-10 articles)
  if (ids.length >= 2 && ids.length <= 10) {
    state.network.once('stabilizationIterationsDone', () => updateArticleBubbles(articleNodeMap, ids));
    state.network.on('dragEnd', () => updateArticleBubbles(articleNodeMap, ids));
    state.network.on('zoom', () => updateArticleBubbles(articleNodeMap, ids));
    state.network.on('stabilizationIterationsDone', () => updateArticleBubbles(articleNodeMap, ids));
    setTimeout(() => updateArticleBubbles(articleNodeMap, ids), 1200);
  } else {
    document.getElementById('article-bubbles').innerHTML = '';
  }

  // Événements de clic
  state.network.on('click', params => {
    if (params.nodes.length > 0) inspectNode(params.nodes[0], state.currentNodes.map);
    else if (params.edges.length > 0) inspectEdge(params.edges[0], visEdges);
    else closeInspect();
  });
}

// ═══════════════════════════════════════════════════════════
// ARTICLE BUBBLES
// ═══════════════════════════════════════════════════════════
function updateArticleBubbles(articleNodeMap, ids) {
  if (!state.network) return;
  const bubblesDiv = document.getElementById('article-bubbles');
  bubblesDiv.innerHTML = '';

  ids.forEach((aid, i) => {
    const nodeIds = (articleNodeMap[aid] || []).filter(nid => {
      try { state.network.getPosition(nid); return true; } catch { return false; }
    });
    if (!nodeIds.length) return;

    let cx = 0, cy = 0;
    nodeIds.forEach(nid => { const pos = state.network.getPosition(nid); cx += pos.x; cy += pos.y; });
    cx /= nodeIds.length; cy /= nodeIds.length;

    const domPos = state.network.canvasToDOM({ x: cx, y: cy });
    const color = ARTICLE_COLORS[i % ARTICLE_COLORS.length];

    const bubble = document.createElement('div');
    bubble.className = 'art-bubble';
    bubble.style.left = domPos.x + 'px';
    bubble.style.top = (domPos.y - 24) + 'px';
    bubble.style.borderColor = color + '66';
    bubble.style.color = color;
    bubble.textContent = '📰 ' + aid.slice(-8);
    bubblesDiv.appendChild(bubble);
  });
}

// ═══════════════════════════════════════════════════════════
// GRAPH CONTROLS
// ═══════════════════════════════════════════════════════════
function graphFit() { if (state.network) state.network.fit({ animation: true }); }

function graphStabilize() { if (state.network) state.network.stabilize(100); }

function togglePhysics() {
  state.physicsOn = !state.physicsOn;
  document.getElementById('ctrl-physics').classList.toggle('on', state.physicsOn);
  if (state.network) state.network.setOptions({ physics: { enabled: state.physicsOn } });
}

function toggleLabels() {
  state.labelsOn = !state.labelsOn;
  document.getElementById('ctrl-labels').classList.toggle('on', state.labelsOn);
  if (state.network && state.currentNodes) {
    const updates = state.currentNodes.data.map(n => ({
      id: n.id,
      label: state.labelsOn
        ? String(n._data?.node?.form || normalizeId(n._data?.node?._id) || '').slice(0, 20)
        : ''
    }));
    state.network.body.data.nodes.update(updates);
  }
}

function toggleAnomalyHighlight() {
  state.anomalyHighlight = !state.anomalyHighlight;
  document.getElementById('ctrl-anomaly-highlight').classList.toggle('on', state.anomalyHighlight);
}

function updateRangeLabels() {
  const n = document.getElementById('max-nodes-range');
  const e = document.getElementById('max-edges-range');
  if (!n || !e) return;
  state.maxNodes = Number(n.value);
  state.maxEdges = Number(e.value);
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
