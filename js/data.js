// ═══════════════════════════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════════════════════════
function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('upload-zone').classList.add('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    document.getElementById('upload-zone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) processFile(file);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            processData(data, file.name);
        } catch (err) {
            alert('Erreur de parsing JSON: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════
// DATA PROCESSING
// ═══════════════════════════════════════════════════════════
function processData(data, sourceLabel = 'Données chargées') {
    if (!Array.isArray(data)) data = [data];

    if (typeof destroyVisuCharts === 'function') destroyVisuCharts();
    if (typeof resetGraphView === 'function') resetGraphView();

    state.events = data;
    state.selectedIds.clear();
    state.currentView = 'selected';
    state.articleDropdownOpen = false;
    buildArticleMap();
    renderArticleList();
    updateSidebarPanels();
    updateVisuStats();
    if (typeof updateHomeMetrics === 'function') updateHomeMetrics();

    state.events = data;
    state.selectedIds.clear();
    state.currentView = 'selected';
    state.articleDropdownOpen = false;
    buildArticleMap();
    renderArticleList();
    updateSidebarPanels();
    updateVisuStats();
    if (typeof updateHomeMetrics === 'function') updateHomeMetrics();

    setGraphPlaceholderState('Veuillez choisir un ou plusieurs articles.');
    const loaded = document.getElementById('file-loaded');
    if (loaded) {
        loaded.style.display = 'block';
        loaded.textContent = `✓ ${data.length.toLocaleString()} événements chargés depuis ${sourceLabel}`;
    }

    state.visuChartsBuilt = false;
    state.treemapBuilt = false;

    if (document.getElementById('page-visu')?.classList.contains('active')) {
        buildVisuCharts();
        if (typeof resizeVisuCharts === 'function') resizeVisuCharts();
        if (typeof buildTreemap === 'function') buildTreemap();
    }
}

function buildArticleMap() {
    state.articleMap = {};
    state.events.forEach(ev => {
        const aid = ev.resultAnalyseId || 'unknown';
        if (!state.articleMap[aid]) state.articleMap[aid] = [];
        state.articleMap[aid].push(ev);
    });
    state.articleIds = Object.keys(state.articleMap);
    const articleCount = document.getElementById('article-count');
    if (articleCount) articleCount.textContent = state.articleIds.length;
}

async function autoLoadDefaultData() {
    try {
        const response = await fetch('./data/export.events.clean.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        processData(data, 'data/export.events.clean.json');
    } catch (err) {
        const loaded = document.getElementById('file-loaded');
        if (loaded) {
            loaded.textContent = `Impossible de charger automatiquement data/export.events.clean.json (${err.message})`;
            loaded.style.color = 'var(--anomaly)';
        }
    }
}

function setGraphPlaceholderState(message, icon = '🕸') {
    const placeholder = document.getElementById('graph-placeholder');
    const placeholderText = document.getElementById('graph-placeholder-text');
    const placeholderIcon = document.getElementById('graph-placeholder-icon');

    if (placeholder) placeholder.style.display = 'flex';
    if (placeholderText) placeholderText.innerHTML = message;
    if (placeholderIcon) placeholderIcon.textContent = icon;
}