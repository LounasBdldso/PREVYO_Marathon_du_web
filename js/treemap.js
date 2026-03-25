// ═══════════════════════════════════════════════════════════
// TREEMAP — Variables de module
// ═══════════════════════════════════════════════════════════
let treemapSvg         = null;
let treemapZoom        = null;
let treemapNodes       = null;
let treemapSearchQuery = '';

// ═══════════════════════════════════════════════════════════
// HELPERS — Hiérarchie
// ═══════════════════════════════════════════════════════════
function prettifyTreemapLabel(label) {
  const map = {
    'nodes.labels': 'Labels des nœuds',
    'edges.type':   'Types de liens',
    'riskCarac':    'Caractéristiques du risque',
    'type':         'Type',
    'domain':       'Domaine',
    'subdomain':    'Sous-domaine',
    'risk':         'Risque'
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
  if (text.length > 14 && fontSize <= 12) return text.slice(0, 10) + '…';
  return text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

// ═══════════════════════════════════════════════════════════
// HELPERS — Stats panel
// ═══════════════════════════════════════════════════════════
function updateTreemapStats(events, field, rootNode) {
  document.getElementById('treemap-stat-total').textContent = events.length.toLocaleString('fr-FR');
  document.getElementById('treemap-stat-depth').textContent = rootNode.height;
  document.getElementById('treemap-top-label').textContent = `Top 5 · ${prettifyTreemapLabel(field)}`;

  const counts = new Map();
  for (const event of events) {
    for (const path of getTreemapPathsForField(event, field)) {
      const key = path[path.length - 1];
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxVal = sorted[0]?.[1] || 1;

  document.getElementById('treemap-top-list').innerHTML = sorted.map(([name, val]) => `
    <li>
      <span class="top-name" title="${name}">${name}</span>
      <div class="bar-wrap"><div class="bar" style="width:${(val / maxVal * 100).toFixed(1)}%"></div></div>
      <span class="top-val">${val}</span>
    </li>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
// HELPERS — Breadcrumb, tooltip, search
// ═══════════════════════════════════════════════════════════
function showTreemapBreadcrumb(d) {
  const el = document.getElementById('treemap-breadcrumb');
  const parts = d.ancestors().reverse();
  el.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    return (i > 0 ? ' <span style="color:var(--muted)">›</span> ' : '')
      + `<span style="color:${isLast ? 'var(--teal)' : 'var(--text)'}">${p.data.name}</span>`;
  }).join('');
  el.classList.add('visible');
}

function hideTreemapBreadcrumb() {
  document.getElementById('treemap-breadcrumb').classList.remove('visible');
}

function showTreemapTooltip(event, d) {
  const tooltip = document.getElementById('treemap-tooltip');
  const path = d.ancestors().reverse().map(x => x.data.name).join(' › ');
  tooltip.innerHTML = `
    <strong>${d.data.name}</strong><br>
    Niveau : ${d.depth}<br>
    Valeur : ${d.value || 0}<br>
    Descendants : ${d.children ? d.children.length : 0}
    <div style="margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid rgba(255,255,255,0.08);color:var(--muted);font-size:0.72rem">${path}</div>
  `;
  tooltip.style.left = `${event.offsetX + 16}px`;
  tooltip.style.top  = `${event.offsetY + 16}px`;
  tooltip.classList.add('visible');
}

function moveTreemapTooltip(event) {
  const tooltip = document.getElementById('treemap-tooltip');
  tooltip.style.left = `${event.offsetX + 16}px`;
  tooltip.style.top  = `${event.offsetY + 16}px`;
}

function hideTreemapTooltip() {
  document.getElementById('treemap-tooltip').classList.remove('visible');
}

function applyTreemapSearch(query) {
  treemapSearchQuery = query.toLowerCase().trim();
  const badge = document.getElementById('treemap-search-count');

  if (!treemapNodes) return;

  if (!treemapSearchQuery) {
    treemapNodes.selectAll('circle').style('opacity', null);
    treemapNodes.selectAll('text').style('opacity', null);
    badge.classList.remove('visible');
    badge.textContent = '';
    return;
  }

  let count = 0;
  treemapNodes.each(function(d) {
    const match = d.data.name.toLowerCase().includes(treemapSearchQuery);
    if (match) count++;
    d3.select(this).select('circle').style('opacity', match ? 1 : 0.15);
    d3.select(this).select('text').style('opacity', match ? 1 : 0.18);
  });

  badge.textContent = `${count} résultat${count > 1 ? 's' : ''}`;
  badge.classList.add('visible');
}

// ═══════════════════════════════════════════════════════════
// BUILD TREEMAP
// ═══════════════════════════════════════════════════════════
function buildTreemap() {
  if (!state.events.length || typeof d3 === 'undefined') return;

  const field   = document.getElementById('treemap-field')?.value || 'type';
  const chartEl = document.getElementById('treemap-chart');
  const wrapEl  = document.getElementById('treemap-wrap');
  if (!chartEl || !wrapEl) return;

  chartEl.innerHTML = '';

  const width    = wrapEl.clientWidth;
  const height   = wrapEl.clientHeight;
  const packSize = Math.min(width, height) * 0.92;
  const originX  = width  / 2 - packSize / 2;
  const originY  = height / 2 - packSize / 2;

  const treeData = buildTreemapHierarchy(state.events, field);
  const root = d3.hierarchy(treeData)
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  d3.pack().size([packSize, packSize]).padding(4)(root);
  const maxDepth = root.height + 1;

  updateTreemapStats(state.events, field, root);

  const svg = d3.select(chartEl)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  treemapSvg = svg;

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('click', () => {
      hideTreemapBreadcrumb();
      svg.transition().duration(600).call(treemapZoom.transform, d3.zoomIdentity);
    });

  const zoomLayer  = svg.append('g');
  const graphLayer = zoomLayer.append('g')
    .attr('transform', `translate(${originX},${originY})`);

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
      showTreemapBreadcrumb(d);
      const scale = Math.max(1, Math.min(8, (packSize * 0.35) / Math.max(d.r, 1)));
      const tx = width  / 2 - (originX + d.x) * scale;
      const ty = height / 2 - (originY + d.y) * scale;
      svg.transition().duration(650)
        .call(treemapZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    });

  treemapNodes = node;

  node.append('circle')
    .attr('r', d => d.r)
    .attr('fill', d => treemapColorForNode(d, maxDepth))
    .attr('fill-opacity', d => d.depth === 0 ? 1 : d.children ? 0.95 : 0.88);

  const labels = node.append('text')
    .style('display', 'none')
    .style('opacity', 0)
    .text('');

  function getScreenNode(d, transform) {
    return {
      x: transform.applyX(originX + d.x),
      y: transform.applyY(originY + d.y),
      r: d.r * transform.k
    };
  }

  function labelFontSize(r) {
    if (r > 180) return 22;
    if (r > 120) return 18;
    if (r > 80)  return 15;
    if (r > 58)  return 12;
    if (r > 40)  return 10;
    return 0;
  }

  function updateLabels(transform = d3.zoomIdentity) {
    labels.each(function(d) {
      const screen    = getScreenNode(d, transform);
      const fs        = labelFontSize(screen.r);
      const isLeaf    = !d.children || d.children.length === 0;
      const isBigParent = d.children && screen.r > 90;
      const visible   = fs > 0 && screen.r > 36 && d.depth > 0 && (isLeaf || isBigParent);

      if (!visible) {
        d3.select(this).style('display', 'none').style('opacity', 0).text('');
        return;
      }

      const fitted = treemapFitLabel(d.data.name, screen.r * 1.45, fs);
      d3.select(this)
        .style('display', null)
        .style('opacity', 1)
        .style('font-size', `${fs}px`)
        .text(fitted);
    });
  }

  treemapZoom = d3.zoom()
    .scaleExtent([1, 12])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform);
      updateLabels(event.transform);
    });

  svg.call(treemapZoom);
  updateLabels();

  if (treemapSearchQuery) {
    applyTreemapSearch(document.getElementById('treemap-search').value);
  }

  state.treemapBuilt = true;
}
