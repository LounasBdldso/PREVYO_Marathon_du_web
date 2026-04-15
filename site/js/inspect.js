// ═══════════════════════════════════════════════════════════
// INSPECTION PANEL
// ═══════════════════════════════════════════════════════════
function inspectNode(nodeId, nodeMap) {
  const visNode = nodeMap[nodeId];
  if (!visNode) return;

  const node = visNode._data?.node;
  const event = visNode._data?.event;
  const panel = document.getElementById('inspect-panel');
  const body = document.getElementById('inspect-body');
  document.getElementById('inspect-title').textContent = '🔵 Nœud';
  panel.classList.remove('hidden');

  const anomaly = event?.anomaly;
  const quasi = event?.quasi_duplicates || [];
  const degree = state.network ? state.network.getConnectedEdges(nodeId).length : 0;
  const mergedEvents = visNode._data?.events || [];
  const dominantLevel = visNode._data?.dominantLevel || 'Inconnu';

  const relatedArticles = new Set();
  state.events.forEach(currentEvent => {
    const hasNode = (currentEvent.nodes || []).some(currentNode => {
      const raw = normalizeId(currentNode._id);
      const current = normalizeId(node?._id);
      return raw && current && raw === current;
    });
    if (hasNode && currentEvent.resultAnalyseId) relatedArticles.add(currentEvent.resultAnalyseId);
  });

  let html = '';

  if (anomaly) {
    let cls = 'green';
    let icon = '✓';
    if (dominantLevel === 'Critique') { cls = 'red'; icon = '⚠'; }
    else if (dominantLevel === 'Suspect') { cls = 'orange'; icon = '⚡'; }
    html += `<div class="anomaly-badge ${cls}">${icon} ${dominantLevel} — Score: ${Number(anomaly.score || 0).toFixed(4)}</div>`;
    if (anomaly.explication) {
      html += `<div class="inspect-field"><div class="if-label">Explication</div><div class="if-value" style="font-size:0.78rem;color:var(--muted)">${anomaly.explication}</div></div>`;
    }
  }

  if (quasi.length > 0) {
    html += `<div class="anomaly-badge orange">🔁 ${quasi.length} quasi-doublon(s)</div>`;
    quasi.forEach(duplicate => {
      html += `
        <div class="inspect-field">
          <div class="if-label">Doublon de</div>
          <div class="if-value code">${String(duplicate.duplicate_of || '').slice(-12)}</div>
          <div class="if-value" style="font-size:0.75rem;color:var(--muted);margin-top:4px">
            Sim: ${Number(duplicate.similarity_score || 0).toFixed(3)} | Cosine: ${Number(duplicate.cosine_similarity || 0).toFixed(3)}<br>Type: ${duplicate.type_partner || 'inconnu'}
          </div>
        </div>`;
    });
  }

  if (node) {
    html += `<div class="inspect-field"><div class="if-label">Forme</div><div class="if-value code">${node.form || '—'}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Labels</div><div class="if-value">${(node.labels || []).map(label => `<span class="if-pill" style="background:rgba(27,174,159,0.1);color:var(--teal)">${label.split('/').pop()}</span>`).join('')}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Niveau dominant</div><div class="if-value">${dominantLevel}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Degré</div><div class="if-value">${degree}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Articles liés</div><div class="if-value">${[...relatedArticles].length ? [...relatedArticles].map(articleId => `<span class="if-pill" style="background:rgba(9,164,232,0.12);color:var(--blue)">${articleId.slice(-8)}</span>`).join('') : '—'}</div></div>`;
    if (mergedEvents.length > 1) {
      html += `<div class="inspect-field"><div class="if-label">Occurrences fusionnées</div><div class="if-value">${mergedEvents.length}</div></div>`;
    }
    if (node.properties && Object.keys(node.properties).length) {
      html += `<div class="inspect-field"><div class="if-label">Propriétés</div><div class="if-value code" style="font-size:0.7rem">${JSON.stringify(node.properties, null, 1).replace(/[{}"]/g, '').trim()}</div></div>`;
    }
  }

  if (event) {
    html += `<div class="inspect-field"><div class="if-label">Type d'événement</div><div class="if-value" style="font-size:0.75rem;color:var(--muted)">${event.type || '—'}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Article</div><div class="if-value code">${(event.resultAnalyseId || '—').slice(-12)}</div></div>`;
    if (event.context) {
      html += `<div class="inspect-field"><div class="if-label">Contexte</div><div class="if-value" style="font-size:0.75rem;color:var(--muted);line-height:1.5">"${event.context.slice(0, 120)}…"</div></div>`;
    }
    if (event.clustering) {
      const clustering = event.clustering;
      html += `<div class="inspect-field"><div class="if-label">Cluster</div><div class="if-value">
        <span class="if-pill" style="background:rgba(98,94,236,0.12);color:var(--dark-blue)">${clustering.cluster_label || 'non-clusteré'}</span>
        ${clustering.is_noise ? '<span class="if-pill" style="background:rgba(255,71,87,0.1);color:var(--anomaly)">bruit</span>' : ''}
      </div></div>`;
    }
  }

  body.innerHTML = html;
}

function inspectEdge(edgeId, visEdges) {
  const visEdge = visEdges.find(edge => edge.id === edgeId || (edge.from + '>' + edge.to + ':' + edge._data?.edge?.type) === edgeId);
  const panel = document.getElementById('inspect-panel');
  const body = document.getElementById('inspect-body');
  document.getElementById('inspect-title').textContent = '🔗 Relation';
  panel.classList.remove('hidden');

  if (!visEdge) {
    body.innerHTML = `<div class="inspect-field"><div class="if-label">ID Vis</div><div class="if-value code">${edgeId}</div></div>`;
    return;
  }

  const edge = visEdge._data?.edge;
  const event = visEdge._data?.event;
  const edgeKind = visEdge._data?.kind;
  const occurrenceCount = visEdge._data?.occurrences || 1;

  let html = '';

  if (edgeKind === 'quasi') {
    const matches = visEdge._data?.matches || [];
    html += `<div class="inspect-field"><div class="if-label">Relation</div><div class="if-value"><span class="if-pill" style="background:rgba(255,165,2,0.12);color:var(--quasi)">Quasi-doublon</span></div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Occurrences</div><div class="if-value">${occurrenceCount}</div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Similarité max</div><div class="if-value">${Number(visEdge._data?.score || 0).toFixed(3)}</div></div>`;
    if (matches.length) {
      html += `<div class="inspect-field"><div class="if-label">Correspondances</div><div class="if-value code">${matches.map(match => `dup: ${String(match.duplicateOf || '').slice(-8)} | sim: ${Number(match.similarity || 0).toFixed(3)} | cos: ${Number(match.cosine || 0).toFixed(3)}`).join('\n')}</div></div>`;
    }
    body.innerHTML = html;
    return;
  }

  if (edge) {
    html += `<div class="inspect-field"><div class="if-label">Type</div><div class="if-value"><span class="if-pill" style="background:rgba(9,164,232,0.12);color:var(--blue)">${edge.type || '—'}</span></div></div>`;
    html += `<div class="inspect-field"><div class="if-label">Occurrences fusionnées</div><div class="if-value">${occurrenceCount}</div></div>`;
    if (edge.properties && Object.keys(edge.properties).length) {
      html += `<div class="inspect-field"><div class="if-label">Propriétés</div><div class="if-value code">${JSON.stringify(edge.properties)}</div></div>`;
    }
  }

  if (event) {
    html += `<div class="inspect-field"><div class="if-label">Article source</div><div class="if-value code">${(event.resultAnalyseId || '—').slice(-12)}</div></div>`;
    if (event.context) {
      html += `<div class="inspect-field"><div class="if-label">Contexte</div><div class="if-value" style="font-size:0.75rem;color:var(--muted);line-height:1.5">"${event.context.slice(0, 100)}…"</div></div>`;
    }
  }

  body.innerHTML = html || '<div style="color:var(--muted);font-size:0.8rem">Pas de détails disponibles</div>';
}

function closeInspect() {
  document.getElementById('inspect-panel').classList.add('hidden');
}
