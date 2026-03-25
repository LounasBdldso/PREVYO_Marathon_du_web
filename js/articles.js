// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function collectEventsForArticleIds(articleIds) {
  const events = [];
  articleIds.forEach(id => {
    (state.articleMap[id] || []).forEach(event => events.push(event));
  });
  return events;
}

function getActiveSidebarEvents() {
  if (state.currentView === 'merged') return state.events || [];
  return collectEventsForArticleIds([...state.selectedIds]);
}

function summarizeEvents(events) {
  const summary = {
    anomalyCount: 0,
    suspectCount: 0,
    quasiEventCount: 0,
    quasiLinkCount: 0
  };

  events.forEach(event => {
    const level = normalizeAnomalyLevel(event.anomaly?.niveau, event.anomaly?.is_anomaly);
    if (level === 'Critique') summary.anomalyCount++;
    if (level === 'Suspect') summary.suspectCount++;

    const quasiCount = event.quasi_duplicates?.length || 0;
    if (quasiCount > 0) {
      summary.quasiEventCount++;
      summary.quasiLinkCount += quasiCount;
    }
  });

  return summary;
}

function setArticleListLayout(mode) {
  const list = document.getElementById('article-list');
  if (!list) return;

  list.classList.remove('expanded', 'collapsed', 'hidden');
  if (mode) list.classList.add(mode);
}

function formatDropdownSummary() {
  const selectedEvents = getActiveSidebarEvents();
  const summary = summarizeEvents(selectedEvents);

  return `
    <span class="article-dropdown-main">
      <span class="article-dropdown-label">
        ${state.selectedIds.size ? `${state.selectedIds.size} article(s) sélectionné(s)` : 'Sélectionner des articles'}
      </span>
      <span class="article-dropdown-stats">
        <span class="article-stat-chip anomaly">⚠ ${summary.anomalyCount + summary.suspectCount}</span>
        <span class="article-stat-chip quasi">🔁 ${summary.quasiLinkCount}</span>
      </span>
    </span>
  `;
}

function buildArticleOption(id) {
  const events = state.articleMap[id] || [];
  const anomalyCount = events.filter(event => isElevatedAnomaly(event.anomaly?.niveau, event.anomaly?.is_anomaly)).length;
  const quasiCount = events.reduce((sum, event) => sum + (event.quasi_duplicates?.length || 0), 0);
  const isChecked = state.selectedIds.has(id);

  return `
    <label class="article-option${isChecked ? ' checked' : ''}">
      <input type="checkbox" value="${id}" ${isChecked ? 'checked' : ''} onchange="toggleArticleCheckbox(this)">
      <span class="article-option-id">${id.slice(-12)}</span>
      <span class="article-option-flags">
        ${anomalyCount ? `<span class="article-flag anomaly">⚠ ${anomalyCount}</span>` : ''}
        ${quasiCount ? `<span class="article-flag quasi">🔁 ${quasiCount}</span>` : ''}
        <span class="article-flag events">• ${events.length}</span>
      </span>
    </label>
  `;
}

// ═══════════════════════════════════════════════════════════
// ARTICLE LIST UI
// ═══════════════════════════════════════════════════════════
function renderArticleList(filter = '') {
  const list = document.getElementById('article-list');
  if (!list) return;

  if (!state.articleIds.length) {
    state.articleDropdownOpen = false;
    setArticleListLayout('collapsed');
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.8rem">Aucun article</div>';
    return;
  }

  if (state.currentView === 'merged') {
    state.articleDropdownOpen = false;
    setArticleListLayout('hidden');
    list.innerHTML = '';
    return;
  }

  setArticleListLayout(state.articleDropdownOpen ? 'expanded' : 'collapsed');

  const normalizedFilter = filter.toLowerCase();
  const filtered = state.articleIds.filter(id => id.toLowerCase().includes(normalizedFilter));
  const openClass = state.articleDropdownOpen ? ' open' : '';

  list.innerHTML = `
    <div class="article-dropdown">
      <button class="article-dropdown-btn${openClass}" type="button" onclick="toggleArticleDropdown(event)">
        ${formatDropdownSummary()}
        <span id="article-dropdown-chevron">▾</span>
      </button>
      <div class="article-dropdown-menu${openClass}" id="article-dropdown-menu">
        ${filtered.length
          ? filtered.map(id => buildArticleOption(id)).join('')
          : '<div class="article-option-empty">Aucun article ne correspond au filtre courant.</div>'}
      </div>
    </div>
    <div class="article-list-summary">
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

  const visibleIds = Array.from(select.options).map(option => option.value);
  visibleIds.forEach(id => state.selectedIds.delete(id));
  Array.from(select.selectedOptions).forEach(option => state.selectedIds.add(option.value));
  updateSidebarPanels();
  renderArticleList(document.getElementById('article-search')?.value || '');
}

function toggleArticle(id, el) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    el.classList.remove('selected');
  } else {
    state.selectedIds.add(id);
    el.classList.add('selected');
  }

  el.querySelector('input').checked = state.selectedIds.has(id);
  updateSidebarPanels();
}

function selectAll() {
  const filter = document.getElementById('article-search').value.toLowerCase();
  state.articleIds
    .filter(id => id.toLowerCase().includes(filter))
    .forEach(id => state.selectedIds.add(id));
  state.articleDropdownOpen = true;
  renderArticleList(filter);
  updateSidebarPanels();
}

function deselectAll() {
  const filter = document.getElementById('article-search').value.toLowerCase();
  state.articleIds
    .filter(id => id.toLowerCase().includes(filter))
    .forEach(id => state.selectedIds.delete(id));
  state.articleDropdownOpen = true;
  renderArticleList(filter);
  updateSidebarPanels();
}

function filterAnomalies() {
  const anomalyIds = state.articleIds.filter(id =>
    (state.articleMap[id] || []).some(event => isElevatedAnomaly(event.anomaly?.niveau, event.anomaly?.is_anomaly))
  );

  state.selectedIds.clear();
  anomalyIds.forEach(id => state.selectedIds.add(id));
  state.articleDropdownOpen = true;
  renderArticleList(document.getElementById('article-search')?.value || '');
  updateSidebarPanels();
}

function syncArticleDropdownUI() {
  const menu = document.getElementById('article-dropdown-menu');
  const button = document.querySelector('.article-dropdown-btn');
  if (menu) menu.classList.toggle('open', state.articleDropdownOpen);
  if (button) button.classList.toggle('open', state.articleDropdownOpen);
}

function toggleArticleDropdown(event) {
  if (event) event.stopPropagation();
  state.articleDropdownOpen = !state.articleDropdownOpen;
  renderArticleList(document.getElementById('article-search')?.value || '');
}

function toggleArticleCheckbox(input) {
  const id = input.value;
  if (input.checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);

  state.articleDropdownOpen = true;
  updateSidebarPanels();
  renderArticleList(document.getElementById('article-search')?.value || '');
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR PANELS (anomalies & quasi-doublons)
// ═══════════════════════════════════════════════════════════
function updateSidebarPanels() {
  const activeEvents = getActiveSidebarEvents();

  // Anomalies
  const alert = document.getElementById('anomaly-alert');
  const list = document.getElementById('anomaly-list');
  const anomalyEvents = activeEvents
    .filter(event => isElevatedAnomaly(event.anomaly?.niveau, event.anomaly?.is_anomaly))
    .sort((a, b) => {
      const aRank = getAnomalyLevelRank(a.anomaly?.niveau, a.anomaly?.is_anomaly);
      const bRank = getAnomalyLevelRank(b.anomaly?.niveau, b.anomaly?.is_anomaly);
      if (bRank !== aRank) return bRank - aRank;
      return Number(b.anomaly?.score || 0) - Number(a.anomaly?.score || 0);
    });

  document.getElementById('anomaly-count-label').textContent = `(${anomalyEvents.length})`;
  if (anomalyEvents.length > 0) {
    alert.classList.add('visible');
    list.innerHTML = anomalyEvents.map(event => `
      <li class="aa-item">
        <strong>${normalizeAnomalyLevel(event.anomaly?.niveau, event.anomaly?.is_anomaly)}</strong>
        (${Number(event.anomaly.score || 0).toFixed(3)})
        ${(event._id?.$oid || '').slice(-6)}
        ${event.anomaly.explication || ''}
      </li>
    `).join('');
  } else {
    alert.classList.remove('visible');
    list.innerHTML = '';
  }

  // Quasi-doublons
  const quasiPanel = document.getElementById('quasi-panel');
  const quasiList = document.getElementById('quasi-list');
  const quasiEvents = activeEvents.filter(event => (event.quasi_duplicates?.length || 0) > 0);
  const quasiCount = quasiEvents.reduce((sum, event) => sum + (event.quasi_duplicates?.length || 0), 0);

  document.getElementById('quasi-count-label').textContent = `(${quasiCount})`;
  if (quasiCount > 0) {
    quasiPanel.classList.add('visible');
    quasiList.innerHTML = quasiEvents
      .sort((a, b) => (b.quasi_duplicates?.length || 0) - (a.quasi_duplicates?.length || 0))
      .map(event => (event.quasi_duplicates || []).map(duplicate => `
        <div class="qp-item">
          <strong>${(event.resultAnalyseId || '—').slice(-8)}</strong>
          · evt ${(event._id?.$oid || '?').slice(-6)}
          → doublon de <strong>${String(duplicate.duplicate_of || '').slice(-6)}</strong>
          <br>
          <span style="color:var(--muted)">
            sim: ${Number(duplicate.similarity_score || 0).toFixed(2)}
            · cosine: ${Number(duplicate.cosine_similarity || 0).toFixed(2)}
            · ${duplicate.type_partner || 'type inconnu'}
          </span>
        </div>
      `).join('')).join('');
  } else {
    quasiPanel.classList.remove('visible');
    quasiList.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════════════════
// VIEW SWITCH (selected / merged)
// ═══════════════════════════════════════════════════════════
function setView(v) {
  state.currentView = v;
  state.articleDropdownOpen = false;
  document.getElementById('view-selected').classList.toggle('active', v === 'selected');
  document.getElementById('view-merged').classList.toggle('active', v === 'merged');
  document.getElementById('view-label').textContent = v === 'merged'
    ? 'Graphe global fusionné'
    : 'Graphe — Articles sélectionnés';
  document.getElementById('selected-controls').style.display = v === 'selected' ? 'block' : 'none';
  document.getElementById('global-controls').classList.toggle('visible', v === 'merged');
  document.getElementById('filter-title').innerHTML = v === 'merged'
    ? `Filtres d'affichage`
    : `Articles (<span id="article-count">${state.articleIds.length}</span>)`;
  renderArticleList(document.getElementById('article-search')?.value || '');
  updateSidebarPanels();
}

document.addEventListener('click', event => {
  const dropdown = document.querySelector('.article-dropdown');
  if (!dropdown || dropdown.contains(event.target)) return;
  if (!state.articleDropdownOpen) return;
  state.articleDropdownOpen = false;
  renderArticleList(document.getElementById('article-search')?.value || '');
});
