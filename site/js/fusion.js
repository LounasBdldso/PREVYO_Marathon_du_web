// ═══════════════════════════════════════════════════════════
// FUSION — module de fusion manuelle de nœuds inter-articles
// ═══════════════════════════════════════════════════════════

const fusion = {
  pairs:    [],   // [{eid1, eid2, aid1, aid2, score}]
  eventA:   null,
  eventB:   null,
  srcA:     null,
  srcB:     null,
  netA:     null,
  netB:     null,
  selA:     null,
  selB:     null,
  history:  [],
};

// ── Options vis.js ────────────────────────────────────────────
const FUSION_VIS_OPTS = {
  physics: {
    enabled: true,
    stabilization: { iterations: 90 }
  },
  interaction: {
    hover: true,
    tooltipDelay: 80,
    navigationButtons: false
  },
  edges: {
    smooth: {
      type: 'dynamic',
      roundness: 0.22
    },
    color: {
      color: 'rgba(120, 156, 196, 0.72)',
      highlight: '#25d3c4',
      hover: '#7be5dc',
      inherit: false
    },
    arrows: {
      to: {
        enabled: true,
        scaleFactor: 0.7
      }
    },
    font: {
      size: 14,
      color: '#f4f8ff',
      face: 'Lexend',
      strokeWidth: 5,
      strokeColor: 'rgba(6,16,31,0.96)',
      background: 'rgba(6,16,31,0.78)',
      vadjust: -8,
      align: 'middle'
    },
    width: 2.2,
    hoverWidth: 2.8,
    selectionWidth: 3.2
  },
  nodes: {
    font: {
      color: '#f5fbff',
      size: 16,
      face: 'Lexend',
      strokeWidth: 6,
      strokeColor: 'rgba(6,16,31,0.98)',
      vadjust: 2
    }
  }
};

// ── Utilitaires ───────────────────────────────────────────────

function dc(obj) { return JSON.parse(JSON.stringify(obj)); }

function fusionNodeLabel(node) {
  const form = node.form || normalizeId(node._id) || '?';
  return String(form).slice(0, 20);
}

function fusionNodeTitle(node) {
  const lines = [
    node.form || normalizeId(node._id),
    (node.labels || []).join(', '),
  ].filter(Boolean);
  return lines.join('\n');
}

// _origin sur un nœud : 'a' = original A, 'b' = migré depuis B, 'shared' = présent dans les deux
function buildFusionVisNodes(nodes, sharedIds, selId) {
  return (nodes || []).map(n => {
    const id         = normalizeId(n._id);
    const kind       = getNodeKind(n.labels || []);
    const cfg        = NODE_TYPE_CONFIG[kind] || NODE_TYPE_CONFIG.other;
    const isSelected = id === selId;

    // Priorité : sélectionné > origine B > partagé > original A
    let bg, border, shadowColor, bw;
    if (isSelected) {
      bg = 'rgba(9,164,232,0.28)'; border = '#09a4e8'; shadowColor = 'rgba(9,164,232,0.45)'; bw = 3.2;
    } else if (n._origin === 'b') {
      bg = 'rgba(255,165,2,0.2)';  border = '#ffa502'; shadowColor = 'rgba(255,165,2,0.35)';  bw = 2.5;
    } else if (n._origin === 'shared' || sharedIds.has(id)) {
      bg = 'rgba(27,174,159,0.22)'; border = '#1bae9f'; shadowColor = 'rgba(27,174,159,0.38)'; bw = 2.5;
    } else {
      bg = 'rgba(107,132,163,0.18)'; border = '#6b84a3'; shadowColor = null; bw = 1.8;
    }

    const originLabel = n._origin === 'b' ? ' [B]' : n._origin === 'shared' ? ' [A+B]' : '';

    return {
      id,
      label: fusionNodeLabel(n) + originLabel,
      title: fusionNodeTitle(n) + (n._origin ? `\nOrigine : ${n._origin === 'b' ? 'migré depuis B' : n._origin === 'shared' ? 'partagé A+B' : 'original A'}` : ''),
      shape: cfg.shape,
      size:  cfg.size,
      font: {
        color: '#f7fbff',
        size: 16,
        face: 'Lexend',
        strokeWidth: 6,
        strokeColor: 'rgba(6,16,31,0.98)',
        bold: isSelected
      },
      color: {
        background: bg, border,
        highlight: { background: bg, border },
        hover:     { background: bg, border },
      },
      borderWidth: bw,
      shadow: shadowColor
        ? { enabled: true, color: shadowColor, size: isSelected ? 12 : 8, x: 0, y: 0 }
        : false,
    };
  });
}

function buildFusionVisEdges(edges) {
  return (edges || []).map((e, i) => ({
    id: `e${i}`,
    from: normalizeId(e.source),
    to:   normalizeId(e.target),
    label: String(e.type || '').split('/').filter(Boolean).slice(-1)[0] || '',
  }));
}

// ── Initialisation ────────────────────────────────────────────

function initFusion() {
  if (!state.events.length) {
    document.getElementById('f-empty').style.display = 'flex';
    document.getElementById('f-content').style.display = 'none';
    return;
  }
  document.getElementById('f-empty').style.display = 'none';
  document.getElementById('f-content').style.display = 'flex';
  buildFusionPairs();
}

function buildFusionPairs() {
  const thr = parseInt(document.getElementById('f-thr')?.value || 90) / 100;
  document.getElementById('f-thr-v').textContent = thr.toFixed(2);

  // Index events par _id (string normalisé)
  const evById = {};
  state.events.forEach(ev => { evById[normalizeId(ev._id)] = ev; });

  const seen = new Set();
  const pairs = [];

  state.events.forEach(ev => {
    const eid1 = normalizeId(ev._id);
    const aid1 = ev.resultAnalyseId || 'unknown';

    (ev.quasi_duplicates || []).forEach(dup => {
      const score = Number(dup.similarity_score || dup.cosine_similarity || 0);
      if (score < thr) return;

      const eid2 = normalizeId(dup.duplicate_of);
      const ev2  = evById[eid2];
      if (!ev2) return;

      const aid2 = ev2.resultAnalyseId || 'unknown';
      if (aid1 === aid2) return; // même article → pas intéressant

      const key = [eid1, eid2].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);

      pairs.push({ eid1, eid2, aid1, aid2, score });
    });
  });

  pairs.sort((a, b) => b.score - a.score);
  fusion.pairs = pairs;

  const pairCountEl = document.getElementById('f-pair-count');
  if (pairCountEl) {
    pairCountEl.textContent = `${pairs.length} ${pairs.length > 1 ? 'paires' : 'paire'}`;
  }
  const pairCountSideEl = document.getElementById('pairCountSide');
  if (pairCountSideEl) {
    pairCountSideEl.textContent = String(pairs.length);
  }

  const sel = document.getElementById('f-pairs');
  sel.innerHTML = pairs.length
    ? pairs.map((p, i) =>
        `<option value="${i}">[${(p.score * 100).toFixed(0)}%] A:${String(p.aid1).slice(0,12)}… — B:${String(p.aid2).slice(0,12)}…</option>`
      ).join('')
    : '<option value="">Aucune paire au-dessus du seuil</option>';

  if (pairs.length) {
    sel.innerHTML = pairs.map((p, i) =>
      `<option value="${i}">[${(p.score * 100).toFixed(0)}%] A:${String(p.aid1).slice(0,12)}... - B:${String(p.aid2).slice(0,12)}...</option>`
    ).join('');
  }

  onFusionPairSel();
}

function onFusionPairSel() {
  const idx = parseInt(document.getElementById('f-pairs').value);
  if (isNaN(idx) || !fusion.pairs[idx]) {
    populateEventSels([], [], '—', '—');
    return;
  }
  const p = fusion.pairs[idx];

  const evById = {};
  state.events.forEach(ev => { evById[normalizeId(ev._id)] = ev; });

  const ev1 = evById[p.eid1];
  const ev2 = evById[p.eid2];

  // Populate sub-dropdowns with all events of each article
  const evsA = state.articleMap[p.aid1] || (ev1 ? [ev1] : []);
  const evsB = state.articleMap[p.aid2] || (ev2 ? [ev2] : []);

  populateEventSels(evsA, evsB, p.aid1, p.aid2);

  // Pre-select the exact matched events
  const selA = document.getElementById('f-ev-a');
  const selB = document.getElementById('f-ev-b');
  const idxA = evsA.findIndex(e => normalizeId(e._id) === p.eid1);
  const idxB = evsB.findIndex(e => normalizeId(e._id) === p.eid2);
  if (idxA >= 0) selA.value = idxA;
  if (idxB >= 0) selB.value = idxB;
}

function populateEventSels(evsA, evsB, aid1, aid2) {
  const selA = document.getElementById('f-ev-a');
  const selB = document.getElementById('f-ev-b');

  selA.innerHTML = evsA.length
    ? evsA.map((e, i) => {
        const type = String(e.type || '').split('/').filter(Boolean).slice(-1)[0] || `Event ${i}`;
        return `<option value="${i}">${type}</option>`;
      }).join('')
    : `<option value="">Article ${aid1} introuvable</option>`;

  selB.innerHTML = evsB.length
    ? evsB.map((e, i) => {
        const type = String(e.type || '').split('/').filter(Boolean).slice(-1)[0] || `Event ${i}`;
        return `<option value="${i}">${type}</option>`;
      }).join('')
    : `<option value="">Article ${aid2} introuvable</option>`;
}

// ── Chargement des graphes ─────────────────────────────────────

function loadFusion() {
  const idx = parseInt(document.getElementById('f-pairs').value);
  if (isNaN(idx) || !fusion.pairs[idx]) return;

  const p    = fusion.pairs[idx];
  const evById = {};
  state.events.forEach(ev => { evById[normalizeId(ev._id)] = ev; });

  const evsA = state.articleMap[p.aid1] || [evById[p.eid1]].filter(Boolean);
  const evsB = state.articleMap[p.aid2] || [evById[p.eid2]].filter(Boolean);

  const iA = parseInt(document.getElementById('f-ev-a').value) || 0;
  const iB = parseInt(document.getElementById('f-ev-b').value) || 0;

  if (!evsA[iA] || !evsB[iB]) return alert('Events introuvables.');

  fusion.srcA    = evsA[iA];
  fusion.srcB    = evsB[iB];
  fusion.eventA  = dc(evsA[iA]);
  fusion.eventB  = dc(evsB[iB]);
  fusion.history = [];
  fusion.selA    = null;
  fusion.selB    = null;

  document.getElementById('f-placeholder').style.display = 'none';
  document.getElementById('f-main').style.display = 'flex';
  // Laisser le navigateur peindre le layout avant que vis.js mesure les containers
  requestAnimationFrame(() => requestAnimationFrame(() => renderFusion()));
}

function resetFusion() {
  if (!fusion.srcA) return;
  fusion.eventA  = dc(fusion.srcA);
  fusion.eventB  = dc(fusion.srcB);
  fusion.history = [];
  fusion.selA    = null;
  fusion.selB    = null;
  requestAnimationFrame(() => requestAnimationFrame(() => renderFusion()));
}

// ── Rendu des graphes ─────────────────────────────────────────

function renderFusion() {
  const ea = fusion.eventA, eb = fusion.eventB;
  if (!ea || !eb) return;

  // IDs partagés
  const idsA   = new Set((ea.nodes || []).map(n => normalizeId(n._id)));
  const idsB   = new Set((eb.nodes || []).map(n => normalizeId(n._id)));
  const shared = new Set([...idsA].filter(id => idsB.has(id)));

  // Titres & stats
  const typeA = String(ea.type || '').split('/').filter(Boolean).slice(-1)[0] || 'Event A';
  const typeB = String(eb.type || '').split('/').filter(Boolean).slice(-1)[0] || 'Event B';
  document.getElementById('f-title-a').textContent  = `Event A — ${typeA}`;
  document.getElementById('f-title-b').textContent  = `Event B — ${typeB}`;
  document.getElementById('f-stats-a').textContent  = `${(ea.nodes||[]).length} nœuds · ${(ea.edges||[]).length} arêtes`;
  document.getElementById('f-stats-b').textContent  = `${(eb.nodes||[]).length} nœuds · ${(eb.edges||[]).length} arêtes`;

  document.getElementById('f-title-a').textContent  = `Event A - ${typeA}`;
  document.getElementById('f-title-b').textContent  = `Event B - ${typeB}`;
  document.getElementById('f-stats-a').textContent  = `${(ea.nodes||[]).length} noeuds - ${(ea.edges||[]).length} aretes`;
  document.getElementById('f-stats-b').textContent  = `${(eb.nodes||[]).length} noeuds - ${(eb.edges||[]).length} aretes`;

  // Contexte textuel de chaque event (extrait de l'article source)
  const ctxA = document.getElementById('f-context-a');
  const ctxB = document.getElementById('f-context-b');
  const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '…' : (s || '');
  ctxA.textContent = truncate(ea.context || '', 220);
  ctxB.textContent = truncate(eb.context || '', 220);
  const truncateClean = (s, n) => s && s.length > n ? s.slice(0, n) + '...' : (s || '');
  ctxA.textContent = truncateClean(ea.context || '', 220);
  ctxB.textContent = truncateClean(eb.context || '', 220);
  document.getElementById('f-sel-a-lbl').textContent = 'aucun';
  document.getElementById('f-sel-b-lbl').textContent = 'aucun';

  // Nœuds partagés badge
  document.getElementById('f-shared-msg').innerHTML = shared.size
    ? `<span class="f-shared-badge">${shared.size} nœud(s) partagé(s) — en violet dans les deux graphes</span>`
    : '';

  if (shared.size) {
    document.getElementById('f-shared-msg').innerHTML = `<span class="f-shared-badge">${shared.size} noeud(s) partages - visibles dans les deux graphes</span>`;
  }

  // Historique
  const hEl = document.getElementById('f-history');
  hEl.innerHTML = fusion.history.length
    ? fusion.history.map((h, i) => `<div class="f-history-item">${i + 1}. ${h.desc}</div>`).join('')
    : '<span style="color:var(--muted);font-size:.8rem">Aucune modification.</span>';
  if (!fusion.history.length) {
    hEl.innerHTML = '<span class="f-history-empty">Aucune modification.</span>';
  }

  // Nettoyer anciens réseaux
  fusion.netA?.destroy();
  fusion.netB?.destroy();
  fusion.selA = null;
  fusion.selB = null;

  fusion.netA = buildFusionNet('f-net-a', ea, 'a', shared);
  fusion.netB = buildFusionNet('f-net-b', eb, 'b', shared);

  updateFusionJSON();
}

function buildFusionNet(containerId, event, which, sharedIds) {
  const container = document.getElementById(containerId);
  const selKey = which === 'a' ? 'selA' : 'selB';
  const lblEl  = document.getElementById(`f-sel-${which}-lbl`);

  const vNodes = buildFusionVisNodes(event.nodes, sharedIds, null);
  const vEdges = buildFusionVisEdges(event.edges);

  const net = new vis.Network(
    container,
    { nodes: new vis.DataSet(vNodes), edges: new vis.DataSet(vEdges) },
    FUSION_VIS_OPTS
  );

  net.once('stabilized', () => net.fit());

  net.on('selectNode', params => {
    if (!params.nodes.length) return;
    fusion[selKey] = params.nodes[0];
    const node = (event.nodes || []).find(n => normalizeId(n._id) === params.nodes[0]);
    lblEl.textContent = node ? fusionNodeLabel(node) : String(params.nodes[0]).slice(0, 16);
  });
  net.on('deselectNode', () => {
    fusion[selKey] = null;
    lblEl.textContent = 'aucun';
  });

  return net;
}

// ── Actions ───────────────────────────────────────────────────

function pushFusionH(desc) {
  fusion.history.push({ desc, a: dc(fusion.eventA), b: dc(fusion.eventB) });
}

function undoFusion() {
  if (!fusion.history.length) return;
  const prev = fusion.history.pop();
  fusion.eventA = prev.a;
  fusion.eventB = prev.b;
  commitToState();
  renderFusion();
}

function doFusionMerge() {
  const canonId  = fusion.selA;
  const absorbId = fusion.selB;
  if (!canonId || !absorbId) return alert('Clique un nœud dans A (canonique) et un nœud dans B (absorbé).');

  const canonNode  = (fusion.eventA.nodes || []).find(n => normalizeId(n._id) === canonId);
  const absorbNode = (fusion.eventB.nodes || []).find(n => normalizeId(n._id) === absorbId);
  if (!canonNode) return alert('Nœud canonique introuvable dans event A.');
  if (!absorbNode) return alert('Nœud absorbé introuvable dans event B.');
  pushFusionH(`Fusion events : "${absorbNode.form ?? absorbId}" (B) absorbé dans A`);

  const canonRawId = canonNode._id;

  // Clé de similarité : forme normalisée + labels triés (même logique que node_merger.py)
  function nodeKey(n) {
    const form = (n.form || '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim();
    const labels = (n.labels || []).slice().sort().join('|');
    return `${form}__${labels}`;
  }

  // 1. Rediriger les arêtes de B : absorbId → canonRawId
  (fusion.eventB.edges || []).forEach(e => {
    if (normalizeId(e.source) === absorbId) e.source = canonRawId;
    if (normalizeId(e.target) === absorbId) e.target = canonRawId;
  });

  // 2. Supprimer le nœud absorbé de B
  fusion.eventB.nodes = (fusion.eventB.nodes || []).filter(n => normalizeId(n._id) !== absorbId);

  // 3. Construire l'index de A par forme+labels ET par _id normalisé
  //    Pour chaque nœud de B qui matche un nœud de A → rediriger ses arêtes vers l'_id de A
  const keyToNodeA  = {};   // nodeKey → nœud de A
  const idToNodeA   = {};   // normalizeId(_id) → nœud de A
  (fusion.eventA.nodes || []).forEach(n => {
    keyToNodeA[nodeKey(n)] = n;
    idToNodeA[normalizeId(n._id)] = n;
    if (!n._origin) n._origin = 'a';
  });

  // 4. Pour chaque nœud de B : chercher un équivalent dans A par forme+labels
  //    Si trouvé → rediriger arêtes de B et marquer comme partagé
  //    Si non trouvé → migrer dans A avec _origin='b'
  for (const nodeB of (fusion.eventB.nodes || [])) {
    const bidStr = normalizeId(nodeB._id);
    const match  = keyToNodeA[nodeKey(nodeB)];

    if (match) {
      // Même entité : rediriger les arêtes de B vers l'_id brut du nœud de A
      (fusion.eventB.edges || []).forEach(e => {
        if (normalizeId(e.source) === bidStr) e.source = match._id;
        if (normalizeId(e.target) === bidStr) e.target = match._id;
      });
      match._origin = 'shared';   // marquer comme partagé dans A
    } else {
      // Nœud unique à B : l'ajouter à A
      nodeB._origin = 'b';
      fusion.eventA.nodes.push(nodeB);
      keyToNodeA[nodeKey(nodeB)] = nodeB;
    }
  }

  // 5. Coller les arêtes de B dans A (dédupliquées par source+target+type)
  const edgeKeyA = new Set(
    (fusion.eventA.edges || []).map(e => `${normalizeId(e.source)}|${normalizeId(e.target)}|${e.type||''}`)
  );
  for (const edge of (fusion.eventB.edges || [])) {
    const key = `${normalizeId(edge.source)}|${normalizeId(edge.target)}|${edge.type||''}`;
    if (!edgeKeyA.has(key)) {
      fusion.eventA.edges.push(edge);
      edgeKeyA.add(key);
    }
  }

  // 6. Supprimer les auto-boucles dans A
  fusion.eventA.edges = (fusion.eventA.edges || []).filter(e =>
    normalizeId(e.source) !== normalizeId(e.target)
  );

  // 7. Vider B
  fusion.eventB.nodes = [];
  fusion.eventB.edges = [];

  commitToState();
  renderFusion();
}

function doFusionDelete(which) {
  const nodeId = which === 'a' ? fusion.selA : fusion.selB;
  if (!nodeId) return alert(`Sélectionne un nœud dans le graphe ${which.toUpperCase()} d'abord.`);

  const ev   = which === 'a' ? fusion.eventA : fusion.eventB;
  const node = (ev.nodes || []).find(n => normalizeId(n._id) === nodeId);
  pushFusionH(`Suppression : "${node?.form ?? nodeId}" dans ${which.toUpperCase()}`);

  ev.nodes = (ev.nodes || []).filter(n => normalizeId(n._id) !== nodeId);
  const remaining = new Set(ev.nodes.map(n => normalizeId(n._id)));
  ev.edges = (ev.edges || []).filter(e =>
    remaining.has(normalizeId(e.source)) && remaining.has(normalizeId(e.target))
  );
  commitToState();
  renderFusion();
}

// ── JSON inline ───────────────────────────────────────────────

function updateFusionJSON() {
  document.getElementById('f-json-a').value = JSON.stringify(fusion.eventA, null, 2);
  document.getElementById('f-json-b').value = JSON.stringify(fusion.eventB, null, 2);
}

function applyFusionEdit(which) {
  const ta = document.getElementById(`f-json-${which}`);
  try {
    const parsed = JSON.parse(ta.value);
    pushFusionH(`Édition JSON manuelle — Event ${which.toUpperCase()}`);
    if (which === 'a') fusion.eventA = parsed;
    else               fusion.eventB = parsed;
    commitToState();
    renderFusion();
  } catch (e) { alert(`JSON invalide : ${e.message}`); }
}

// ── Commit dans state.events ──────────────────────────────────

function commitToState() {
  // Remplace les events originaux dans state.events par les versions modifiées
  const oidA = normalizeId(fusion.srcA._id);
  const oidB = normalizeId(fusion.srcB._id);
  for (let i = 0; i < state.events.length; i++) {
    const oid = normalizeId(state.events[i]._id);
    if (oid === oidA) state.events[i] = fusion.eventA;
    else if (oid === oidB) state.events[i] = fusion.eventB;
  }
  // Mettre à jour fusion.srcA/srcB pour que reset pointe sur la version courante
  fusion.srcA = fusion.eventA;
  fusion.srcB = fusion.eventB;
  // Reconstruire l'index articles
  if (typeof buildArticleMap === 'function') buildArticleMap();
}

// ── Export ────────────────────────────────────────────────────

function downloadFusionJSON() {
  commitToState();
  const blob = new Blob([JSON.stringify(state.events, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `export.events.merged_${Date.now()}.json`,
  });
  a.click();
}
