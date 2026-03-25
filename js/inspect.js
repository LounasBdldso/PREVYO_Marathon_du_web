// ═══════════════════════════════════════════════════════════
// INSPECTION PANEL
// ═══════════════════════════════════════════════════════════
function inspectNode(nodeId, nodeMap) {
  const vn = nodeMap[nodeId];
  if (!vn) return;

  const n = vn._data?.node;
  const ev = vn._data?.event;
  const panel = document.getElementById('inspect-panel');
  const body = document.getElementById('inspect-body');
  document.getElementById('inspect-title').textContent = '🔵 Nœud';
  panel.classList.remove('hidden');

  const anomaly = ev?.anomaly;
  const quasi = ev?.quasi_duplicates || [];
  const degree = state.network ? state.network.getConnectedEdges(nodeId).length : 0;

  const relatedArticles = new Set();
  state.events.forEach(evt => {
    const hasNode = (evt.nodes || []).some(x => {
      const raw = normalizeId(x._id);
      const current = normalizeId(n?._id);
      return raw && current && raw === current;
    });
    if (hasNode && evt.resultAnalyseId) relatedArticles.add(evt.resultAnalyseId);
  });

  let html = '';

  // Badge anomalie
  if (anomaly) {
    let cls = 'green', icon = '✓';
    if (anomaly.is_anomaly) { cls = 'red'; icon = '⚠'; }
    else if (anomaly.niveau === 'Suspect') { cls = 'orange'; icon = '⚡'; }
    html += `<div class="anomaly-badge ${cls}">${icon} ${anomaly.niveau} — Score: ${anomaly.score?.toFixed(4)}</div>`;
    if (anomaly.explication) html += `<div class="inspect-field"><div class="if-label">Explication</div><div class="if-value" style="font-size:0.78rem;color:var(--muted)">${anomaly.explication}</div></div>`;
  }

  // Quasi-doublons
  if (quasi.length > 0) {
    html += `<div class="anomaly-badge orange">🔁 ${quasi.length} quasi-doublon(s)</div>`;
    quasi.forEach(q => {
      html += `
        <div class="inspect-field">
          <div class="if-label">Doublon de</div>
          <div class="if-value code">${q.duplicate_of.slice(-12)}</div>
          <div class="if-value" style="font-size:0.75rem;color:var(--muted);margin-top:4px">
            Sim: ${q.similarity_score.toFixed(3)} | Cosine: ${q.cosine_similarity.toFixed(3)}<br>Type: ${q.type_partner}
          </div>
        </div>`;
    });
  }

  // Infos nœud
  if (n) {
    html += `<div class="inspect-field"><div class="if-label">Forme</div><div class="if-value code">${n.form || '—'}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Labels</div><div class="if-value">${(n.labels || []).map(l => `<span class="if-pill" style="background:rgba(27,174,159,0.1);color:var(--teal)">${l.split('/').pop()}</span>`).join('')}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Degré</div><div class="if-value">${degree}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Articles liés</div><div class="if-value">${[...relatedArticles].length ? [...relatedArticles].map(a => `<span class="if-pill" style="background:rgba(9,164,232,0.12);color:var(--blue)">${a.slice(-8)}</span>`).join('') : '—'}</div></div>`;
    if (n.properties && Object.keys(n.properties).length) {
      html += `<div class="inspect-field"><div class="if-label">Propriétés</div><div class="if-value code" style="font-size:0.7rem">${JSON.stringify(n.properties, null, 1).replace(/[{}"]/g, '').trim()}</div></div>`;
    }
  }

  // Infos événement
  if (ev) {
    html += `<div class="inspect-field"><div class="if-label">Type d'événement</div><div class="if-value" style="font-size:0.75rem;color:var(--muted)">${ev.type || '—'}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Article</div><div class="if-value code">${(ev.resultAnalyseId || '—').slice(-12)}</div></div>`;
    if (ev.context) html += `<div class="inspect-field"><div class="if-label">Contexte</div><div class="if-value" style="font-size:0.75rem;color:var(--muted);line-height:1.5">"${ev.context.slice(0, 120)}…"</div></div>`;
    if (ev.clustering) {
      const c = ev.clustering;
      html += `<div class="inspect-field"><div class="if-label">Cluster</div><div class="if-value">
        <span class="if-pill" style="background:rgba(98,94,236,0.12);color:var(--dark-blue)">${c.cluster_label || 'non-clusteré'}</span>
        ${c.is_noise ? '<span class="if-pill" style="background:rgba(255,71,87,0.1);color:var(--anomaly)">bruit</span>' : ''}
      </div></div>`;
    }
  }

  body.innerHTML = html;
}

function inspectEdge(edgeId, visEdges) {
  const ve = visEdges.find(e => e.id === edgeId || (e.from + '>' + e.to + ':' + e._data?.edge?.type) === edgeId);
  const panel = document.getElementById('inspect-panel');
  const body = document.getElementById('inspect-body');
  document.getElementById('inspect-title').textContent = '🔗 Relation';
  panel.classList.remove('hidden');

  if (!ve) {
    body.innerHTML = `<div class="inspect-field"><div class="if-label">ID Vis</div><div class="if-value code">${edgeId}</div></div>`;
    return;
  }

  const edge = ve._data?.edge;
  const ev = ve._data?.event;
  let occurrenceCount = 1;
  if (state.currentEdges?.data?.length) {
    occurrenceCount = state.currentEdges.data.filter(e =>
      e.from === ve.from && e.to === ve.to && e.label === ve.label
    ).length || 1;
  }

  let html = '';
  if (edge) {
    html += `<div class="inspect-field"><div class="if-label">Type</div><div class="if-value"><span class="if-pill" style="background:rgba(9,164,232,0.12);color:var(--blue)">${edge.type || '—'}</span></div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Occurrences fusionnées</div><div class="if-value">${occurrenceCount}</div></div>`;
    if (edge.properties && Object.keys(edge.properties).length) {
      html += `<div class="inspect-field"><div class="if-label">Propriétés</div><div class="if-value code">${JSON.stringify(edge.properties)}</div></div>`;
    }
  }
  if (ev) {
    html += `<div class="inspect-field"><div class="if-label">Article source</div><div class="if-value code">${(ev.resultAnalyseId || '—').slice(-12)}</div></div>`;
    if (ev.context) html += `<div class="inspect-field"><div class="if-label">Contexte</div><div class="if-value" style="font-size:0.75rem;color:var(--muted);line-height:1.5">"${ev.context.slice(0, 100)}…"</div></div>`;
  }

  body.innerHTML = html || '<div style="color:var(--muted);font-size:0.8rem">Pas de détails disponibles</div>';
}

function closeInspect() {
  document.getElementById('inspect-panel').classList.add('hidden');
}
