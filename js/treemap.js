// ═══════════════════════════════════════════════════════════
// TREEMAP — Variables de module
// ═══════════════════════════════════════════════════════════
let treemapSvg = null;
let treemapZoom = null;
let treemapNodes = null;
let treemapSearchQuery = '';
let treemapLabelLayer = null;
let treemapCurrentTransform = d3.zoomIdentity;
let treemapFocusedNode = null;
let treemapRootNode = null;
let treemapOriginX = 0;
let treemapOriginY = 0;
let treemapWidth = 0;
let treemapHeight = 0;
let treemapPackSize = 0;

// ═══════════════════════════════════════════════════════════
// HELPERS — Hiérarchie
// ═══════════════════════════════════════════════════════════
function prettifyTreemapLabel(label) {
  const map = {
    'nodes.labels': 'Labels des nœuds',
    'edges.type': 'Types de liens',
    'riskCarac': 'Caractéristiques du risque',
    'type': 'Type',
    'domain': 'Domaine',
    'subdomain': 'Sous-domaine',
    'risk': 'Risque'
  };
  return map[label] || label;
}

function getTreemapPathsForField(event, field) {
  if (field === 'nodes.labels') {
    const out = [];
    for (const node of event.nodes || []) {
      for (const label of node.labels || []) {
        if (typeof label === 'string' && label.trim()) {
          out.push(label.split('/').filter(Boolean));
        }
      }
    }
    return out;
  }

  if (field === 'edges.type') {
    const out = [];
    for (const edge of event.edges || []) {
      if (typeof edge.type === 'string' && edge.type.trim()) {
        out.push(edge.type.split('/').filter(Boolean));
      }
    }
    return out;
  }

  const raw = event[field];
  if (raw == null || raw === '') return [['Non renseigné']];

  if (Array.isArray(raw)) {
    return raw
      .filter(v => v != null && String(v).trim() !== '')
      .map(v => String(v).split('/').filter(Boolean));
  }

  return [String(raw).split('/').filter(Boolean)];
}

function createTreemapNode(name) {
  return { name, children: new Map(), value: 0 };
}

function addTreemapPath(root, parts) {
  if (!parts || !parts.length) return;
  let node = root;
  node.value += 1;
  for (const part of parts) {
    if (!part) continue;
    if (!node.children.has(part)) node.children.set(part, createTreemapNode(part));
    node = node.children.get(part);
    node.value += 1;
  }
}

function finalizeTreemapNode(node) {
  const children = Array.from(node.children.values()).map(finalizeTreemapNode);
  if (children.length) return { name: node.name, children };
  return { name: node.name, value: node.value };
}

function buildTreemapHierarchy(events, field) {
  const root = createTreemapNode('PREVYO');
  for (const event of events) {
    const paths = getTreemapPathsForField(event, field);
    for (const path of paths) addTreemapPath(root, path);
  }
  return finalizeTreemapNode(root);
}

// ═══════════════════════════════════════════════════════════
// HELPERS — Couleurs & labels
// ═══════════════════════════════════════════════════════════
function treemapColorForNode(d, maxDepth) {
  const t = maxDepth <= 1 ? 0 : d.depth / (maxDepth - 1);
  const palette = [
    [27, 174, 159],
    [9, 164, 232],
    [98, 94, 236],
    [189, 51, 209]
  ];
  const scaled = t * (palette.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const c1 = palette[i];
  const c2 = palette[Math.min(i + 1, palette.length - 1)];
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * frac);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * frac);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * frac);
  return `rgb(${r},${g},${b})`;
}

function treemapFitLabel(text, maxWidth, fontSize) {
  if (!text) return '';
  const estimated = text.length * fontSize * 0.56;
  if (estimated <= maxWidth) return text;

  const maxChars = Math.max(3, Math.floor(maxWidth / (fontSize * 0.48)) - 2);
  if (text.length > 16 && fontSize <= 12) return text.slice(0, 11) + '…';
  return text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

function treemapIsDescendantOf(node, ancestor) {
  if (!ancestor) return true;
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function treemapGetScreenNode(d, transform = d3.zoomIdentity) {
  return {
    x: transform.applyX(treemapOriginX + d.x),
    y: transform.applyY(treemapOriginY + d.y),
    r: d.r * transform.k
  };
}

function treemapLabelFontSize(r) {
  if (r > 210) return 24;
  if (r > 150) return 19;
  if (r > 105) return 15;
  if (r > 70) return 12;
  if (r > 48) return 10;
  return 0;
}

function treemapComputeLabelCandidates(nodes, transform) {
  const candidates = [];

  nodes.forEach(d => {
    if (d.depth === 0) return;

    const screen = treemapGetScreenNode(d, transform);
    const fs = treemapLabelFontSize(screen.r);
    const isLeaf = !d.children || d.children.length === 0;
    const focusedBranch = treemapFocusedNode ? treemapIsDescendantOf(d, treemapFocusedNode) : true;
    const enoughSpace = screen.r > 42;
    const visible = focusedBranch && enoughSpace && fs > 0 && (isLeaf || screen.r > 92);

    if (!visible) return;

    const fitted = treemapFitLabel(d.data.name, screen.r * 1.35, fs);
    const width = Math.min(screen.r * 1.55, fitted.length * fs * 0.58);
    const height = fs * 1.35;

    candidates.push({
      node: d,
      text: fitted,
      x: screen.x,
      y: screen.y,
      fontSize: fs,
      width,
      height,
      radius: screen.r,
      priority: (screen.r * 10) + (isLeaf ? 20 : 0) - d.depth
    });
  });

  return candidates.sort((a, b) => b.priority - a.priority);
}

function treemapBoxesOverlap(a, b) {
  return !(
    a.x + a.width / 2 < b.x - b.width / 2 ||
    a.x - a.width / 2 > b.x + b.width / 2 ||
    a.y + a.height / 2 < b.y - b.height / 2 ||
    a.y - a.height / 2 > b.y + b.height / 2
  );
}

function updateTreemapLabels(transform = d3.zoomIdentity) {
  if (!treemapNodes) return;

  const nodes = treemapNodes.data();
  const labels = treemapNodes.selectAll('text');
  labels.style('display', 'none').style('opacity', 0).text('');

  const accepted = [];
  const candidates = treemapComputeLabelCandidates(nodes, transform);

  candidates.forEach(candidate => {
    const outOfFrame =
      candidate.x < 20 ||
      candidate.y < 20 ||
      candidate.x > treemapWidth - 20 ||
      candidate.y > treemapHeight - 20;

    if (outOfFrame) return;

    const overlaps = accepted.some(box => treemapBoxesOverlap(candidate, box));
    if (overlaps) return;

    accepted.push(candidate);

    treemapNodes
      .filter(d => d === candidate.node)
      .select('text')
      .style('display', null)
      .style('opacity', 1)
      .style('font-size', `${candidate.fontSize}px`)
      .attr('dy', '0.35em')
      .text(candidate.text);
  });
}

function updateTreemapNodeOpacity() {
  if (!treemapNodes) return;

  treemapNodes.each(function (d) {
    const circle = d3.select(this).select('circle');
    const text = d3.select(this).select('text');
    const searchMatch = !treemapSearchQuery || d.data.name.toLowerCase().includes(treemapSearchQuery);
    const focusMatch = !treemapFocusedNode || treemapIsDescendantOf(d, treemapFocusedNode) || treemapIsDescendantOf(treemapFocusedNode, d);

    const opacity = searchMatch && focusMatch ? 1 : (focusMatch ? 0.22 : 0.08);
    circle.style('opacity', opacity);
    text.style('opacity', searchMatch && focusMatch ? 1 : 0.16);
  });
}

// ═══════════════════════════════════════════════════════════
// HELPERS — Stats panel
// ═══════════════════════════════════════════════════════════
function updateTreemapStats(events, field, rootNode) {
  const totalEl = document.getElementById('treemap-stat-total');
  const depthEl = document.getElementById('treemap-stat-depth');
  const topLabelEl = document.getElementById('treemap-top-label');
  const topListEl = document.getElementById('treemap-top-list');

  if (totalEl) totalEl.textContent = events.length.toLocaleString('fr-FR');
  if (depthEl) depthEl.textContent = rootNode.height;
  if (topLabelEl) topLabelEl.textContent = `Top 5 · ${prettifyTreemapLabel(field)}`;

  const counts = new Map();
  for (const event of events) {
    for (const path of getTreemapPathsForField(event, field)) {
      const key = path[path.length - 1];
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxVal = sorted[0]?.[1] || 1;

  if (topListEl) {
    topListEl.innerHTML = sorted.map(([name, val]) => `
      <li>
        <span class="top-name" title="${name}">${name}</span>
        <div class="bar-wrap"><div class="bar" style="width:${(val / maxVal * 100).toFixed(1)}%"></div></div>
        <span class="top-val">${val}</span>
      </li>
    `).join('');
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS — Breadcrumb, tooltip, search
// ═══════════════════════════════════════════════════════════
function showTreemapBreadcrumb(d) {
  const el = document.getElementById('treemap-breadcrumb');
  if (!el) return;

  const parts = d.ancestors().reverse();
  el.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    return (i > 0 ? ' <span style="color:var(--muted)">›</span> ' : '')
      + `<span style="color:${isLast ? 'var(--teal)' : 'var(--text)'}">${p.data.name}</span>`;
  }).join('');
  el.classList.add('visible');
}

function hideTreemapBreadcrumb() {
  const el = document.getElementById('treemap-breadcrumb');
  if (el) el.classList.remove('visible');
}

function showTreemapTooltip(event, d) {
  const tooltip = document.getElementById('treemap-tooltip');
  if (!tooltip) return;

  const path = d.ancestors().reverse().map(x => x.data.name).join(' › ');
  tooltip.innerHTML = `
    <strong>${d.data.name}</strong><br>
    Niveau : ${d.depth}<br>
    Valeur : ${d.value || 0}<br>
    Descendants directs : ${d.children ? d.children.length : 0}
    <div style="margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid rgba(255,255,255,0.08);color:var(--muted);font-size:0.72rem">${path}</div>
  `;
  tooltip.style.left = `${event.offsetX + 16}px`;
  tooltip.style.top = `${event.offsetY + 16}px`;
  tooltip.classList.add('visible');
}

function moveTreemapTooltip(event) {
  const tooltip = document.getElementById('treemap-tooltip');
  if (!tooltip) return;
  tooltip.style.left = `${event.offsetX + 16}px`;
  tooltip.style.top = `${event.offsetY + 16}px`;
}

function hideTreemapTooltip() {
  const tooltip = document.getElementById('treemap-tooltip');
  if (tooltip) tooltip.classList.remove('visible');
}

function applyTreemapSearch(query) {
  treemapSearchQuery = String(query || '').toLowerCase().trim();
  const badge = document.getElementById('treemap-search-count');

  if (!treemapNodes || !badge) return;

  if (!treemapSearchQuery) {
    badge.classList.remove('visible');
    badge.textContent = '';
    updateTreemapNodeOpacity();
    updateTreemapLabels(treemapCurrentTransform);
    return;
  }

  let count = 0;
  treemapNodes.each(function (d) {
    if (d.data.name.toLowerCase().includes(treemapSearchQuery)) count++;
  });

  badge.textContent = `${count} résultat${count > 1 ? 's' : ''}`;
  badge.classList.add('visible');

  updateTreemapNodeOpacity();
  updateTreemapLabels(treemapCurrentTransform);
}

function resetTreemapView(withAnimation = false) {
  treemapFocusedNode = null;
  hideTreemapBreadcrumb();

  if (!treemapSvg || !treemapZoom) return;

  const target = d3.zoomIdentity;
  const selection = withAnimation ? treemapSvg.transition().duration(600) : treemapSvg;
  selection.call(treemapZoom.transform, target);
}

function focusTreemapNode(d, withAnimation = true) {
  if (!treemapSvg || !treemapZoom) return;

  treemapFocusedNode = d;
  showTreemapBreadcrumb(d);

  const scale = Math.max(1.1, Math.min(7, (treemapPackSize * 0.52) / Math.max(d.r, 1)));
  const tx = treemapWidth / 2 - (treemapOriginX + d.x) * scale;
  const ty = treemapHeight / 2 - (treemapOriginY + d.y) * scale;

  const target = d3.zoomIdentity.translate(tx, ty).scale(scale);
  const selection = withAnimation ? treemapSvg.transition().duration(700) : treemapSvg;
  selection.call(treemapZoom.transform, target);
}

// ═══════════════════════════════════════════════════════════
// BUILD TREEMAP
// ═══════════════════════════════════════════════════════════
function buildTreemap() {
  if (!state.events.length || typeof d3 === 'undefined') return;

  const field = document.getElementById('treemap-field')?.value || 'type';
  const chartEl = document.getElementById('treemap-chart');
  const wrapEl = document.getElementById('treemap-wrap');
  if (!chartEl || !wrapEl) return;

  chartEl.innerHTML = '';
  treemapFocusedNode = null;
  treemapCurrentTransform = d3.zoomIdentity;

  treemapWidth = wrapEl.clientWidth;
  treemapHeight = wrapEl.clientHeight;
  treemapPackSize = Math.min(treemapWidth, treemapHeight) * 0.9;
  treemapOriginX = treemapWidth / 2 - treemapPackSize / 2;
  treemapOriginY = treemapHeight / 2 - treemapPackSize / 2;

  const treeData = buildTreemapHierarchy(state.events, field);
  const root = d3.hierarchy(treeData)
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  treemapRootNode = root;

  d3.pack().size([treemapPackSize, treemapPackSize]).padding(5)(root);
  const maxDepth = root.height + 1;

  updateTreemapStats(state.events, field, root);

  const svg = d3.select(chartEl)
    .append('svg')
    .attr('viewBox', `0 0 ${treemapWidth} ${treemapHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  treemapSvg = svg;

  svg.append('rect')
    .attr('width', treemapWidth)
    .attr('height', treemapHeight)
    .attr('fill', 'transparent')
    .on('click', () => resetTreemapView(true));

  const zoomLayer = svg.append('g');
  const graphLayer = zoomLayer.append('g')
    .attr('transform', `translate(${treemapOriginX},${treemapOriginY})`);

  const nodes = root.descendants();

  const node = graphLayer.selectAll('g.treemap-node')
    .data(nodes)
    .join('g')
    .attr('class', 'treemap-node')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .on('mouseenter', (event, d) => showTreemapTooltip(event, d))
    .on('mousemove', moveTreemapTooltip)
    .on('mouseleave', hideTreemapTooltip)
    .on('click', (event, d) => {
      event.stopPropagation();
      focusTreemapNode(d, true);
    });

  treemapNodes = node;

  node.append('circle')
    .attr('r', d => d.r)
    .attr('fill', d => treemapColorForNode(d, maxDepth))
    .attr('fill-opacity', d => d.depth === 0 ? 1 : d.children ? 0.94 : 0.88);

  node.append('text')
    .style('display', 'none')
    .style('opacity', 0)
    .text('');

  treemapZoom = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      treemapCurrentTransform = event.transform;
      zoomLayer.attr('transform', event.transform);
      updateTreemapNodeOpacity();
      updateTreemapLabels(event.transform);
    });

  svg.call(treemapZoom);
  updateTreemapNodeOpacity();
  updateTreemapLabels();

  if (treemapSearchQuery) {
    applyTreemapSearch(document.getElementById('treemap-search')?.value || '');
  }

  state.treemapBuilt = true;
}