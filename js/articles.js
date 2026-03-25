// ═══════════════════════════════════════════════════════════
// ARTICLE LIST UI
// ═══════════════════════════════════════════════════════════
function renderArticleList(filter = '') {
  const list = document.getElementById('article-list');
  if (!state.articleIds.length) {
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.8rem">Aucun article</div>';
    return;
  }

  if (state.currentView === 'merged') {
    list.innerHTML = `<div style="font-size:0.78rem;color:var(--muted);line-height:1.6">En vue globale fusionnée, les filtres d'affichage remplacent la sélection d'articles.</div>`;
    return;
  }

  const filtered = state.articleIds.filter(id => id.toLowerCase().includes(filter.toLowerCase()));
  list.innerHTML = `
    <div class="article-dropdown">
      <button class="article-dropdown-btn" type="button" onclick="toggleArticleDropdown()">
        ${state.selectedIds.size} article(s) sélectionné(s)
        <span id="article-dropdown-chevron">▾</span>
      </button>
      <div class="article-dropdown-menu" id="article-dropdown-menu">
        ${filtered.map(id => {
          const evts = state.articleMap[id];
          const anomalyCount = evts.filter(e => e.anomaly?.is_anomaly).length;
          const quasiCount = evts.filter(e => e.quasi_duplicates?.length > 0).length;
          return `
            <label class="article-option">
              <input type="checkbox" value="${id}" ${state.selectedIds.has(id) ? 'checked' : ''} onchange="toggleArticleCheckbox(this)">
              <span class="article-option-id">${id.slice(-12)}</span>
              <span class="article-option-meta">
                ${anomalyCount ? `⚠${anomalyCount}` : ''}
                ${quasiCount ? ` 🔁${quasiCount}` : ''}
                •${evts.length}
              </span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
    <div style="font-size:0.72rem;color:var(--muted);padding:0 0.1rem">
      ${filtered.length.toLocaleString()} article(s) visibles, ${state.selectedIds.size.toLocaleString()} sélectionné(s)
    </div>
  `;
}

function filterArticles() {
  renderArticleList(document.getElementById('article-search').value);
}

function syncSelectedFromDropdown() {
  const select = document.getElementById('article-select');
  if (!select) return;
  const visibleIds = Array.from(select.options).map(o => o.value);
  visibleIds.forEach(id => state.selectedIds.delete(id));
  Array.from(select.selectedOptions).forEach(opt => state.selectedIds.add(opt.value));
  updateSidebarPanels();
  renderArticleList(document.getElementById('article-search')?.value || '');
}

function toggleArticle(id, el) {
  if (state.selectedIds.has(id)) { state.selectedIds.delete(id); el.classList.remove('selected'); }
  else { state.selectedIds.add(id); el.classList.add('selected'); }
  el.querySelector('input').checked = state.selectedIds.has(id);
  updateSidebarPanels();
}

function selectAll() {
  const filter = document.getElementById('article-search').value.toLowerCase();
  state.articleIds.filter(id => id.toLowerCase().includes(filter)).forEach(id => state.selectedIds.add(id));
  renderArticleList(filter);
  updateSidebarPanels();
}

function deselectAll() {
  const filter = document.getElementById('article-search').value.toLowerCase();
  state.articleIds.filter(id => id.toLowerCase().includes(filter)).forEach(id => state.selectedIds.delete(id));
  renderArticleList(filter);
  updateSidebarPanels();
}

function filterAnomalies() {
  const anomalyIds = state.articleIds.filter(id => state.articleMap[id].some(e => e.anomaly?.is_anomaly));
  state.selectedIds.clear();
  anomalyIds.forEach(id => state.selectedIds.add(id));
  renderArticleList();
  updateSidebarPanels();
}

function toggleArticleDropdown() {
  document.getElementById('article-dropdown-menu')?.classList.toggle('open');
}

function toggleArticleCheckbox(input) {
  const id = input.value;
  if (input.checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  updateSidebarPanels();
  renderArticleList(document.getElementById('article-search')?.value || '');
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR PANELS (anomalies & quasi-doublons)
// ═══════════════════════════════════════════════════════════
function updateSidebarPanels() {
  // Anomalies
  const alert = document.getElementById('anomaly-alert');
  const list = document.getElementById('anomaly-list');
  const anomalyEvts = [];
  state.selectedIds.forEach(id => {
    (state.articleMap[id] || []).forEach(e => { if (e.anomaly?.is_anomaly) anomalyEvts.push(e); });
  });
  document.getElementById('anomaly-count-label').textContent = `(${anomalyEvts.length})`;
  if (anomalyEvts.length > 0) {
    alert.classList.add('visible');
    list.innerHTML = anomalyEvts.map(e =>
      `<li class="aa-item"><strong>${e.anomaly.niveau}</strong> (${e.anomaly.score.toFixed(3)}) ${e._id?.$oid?.slice(-6) || ''} ${e.anomaly.explication || ''}</li>`
    ).join('');
  } else {
    alert.classList.remove('visible');
  }

  // Quasi-doublons
  const qp = document.getElementById('quasi-panel');
  const ql = document.getElementById('quasi-list');
  const quasiEvts = [];
  state.selectedIds.forEach(id => {
    (state.articleMap[id] || []).forEach(e => { if (e.quasi_duplicates?.length > 0) quasiEvts.push(e); });
  });
  const quasiCount = quasiEvts.reduce((acc, e) => acc + (e.quasi_duplicates?.length || 0), 0);
  document.getElementById('quasi-count-label').textContent = `(${quasiCount})`;
  if (quasiCount > 0) {
    qp.classList.add('visible');
    ql.innerHTML = quasiEvts.map(e =>
      e.quasi_duplicates.map(q => `
        <div class="qp-item">
          <strong>${(e.resultAnalyseId || '—').slice(-8)}</strong>
          · evt ${e._id?.$oid?.slice(-6) || '?'}
          → doublon de <strong>${q.duplicate_of.slice(-6)}</strong>
          <br>
          <span style="color:var(--muted)">
            sim: ${Number(q.similarity_score || 0).toFixed(2)}
            · cosine: ${Number(q.cosine_similarity || 0).toFixed(2)}
            · ${q.type_partner || 'type inconnu'}
          </span>
        </div>
      `).join('')
    ).join('');
  } else {
    qp.classList.remove('visible');
  }
}

// ═══════════════════════════════════════════════════════════
// VIEW SWITCH (selected / merged)
// ═══════════════════════════════════════════════════════════
function setView(v) {
  state.currentView = v;
  document.getElementById('view-selected').classList.toggle('active', v === 'selected');
  document.getElementById('view-merged').classList.toggle('active', v === 'merged');
  document.getElementById('view-label').textContent = v === 'merged'
    ? 'Graphe global fusionné' : 'Graphe — Articles sélectionnés';
  document.getElementById('selected-controls').style.display = v === 'selected' ? 'block' : 'none';
  document.getElementById('global-controls').classList.toggle('visible', v === 'merged');
  document.getElementById('filter-title').innerHTML = v === 'merged'
      ? `Filtres d'affichage`
    : `Articles (<span id="article-count">${state.articleIds.length}</span>)`;
  renderArticleList(document.getElementById('article-search')?.value || '');
  updateSidebarPanels();
}
