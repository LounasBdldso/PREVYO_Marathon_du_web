// FILE HANDLING
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

function cloneDefaultDataset(data) {
    if (!data) return null;
    if (typeof structuredClone === 'function') return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
}

function getEmbeddedDefaultData() {
    if (!window.PREVYO_DEFAULT_DATA) return null;
    return cloneDefaultDataset(window.PREVYO_DEFAULT_DATA);
}

// DATA PROCESSING
function processData(data, sourceLabel = 'Donnees chargees', options = {}) {
    if (!Array.isArray(data)) data = [data];

    if (typeof destroyVisuCharts === 'function') destroyVisuCharts();
    if (typeof resetGraphView === 'function') resetGraphView();

    state.events = data;
    state.selectedIds.clear();
    state.currentView = 'selected';
    state.articleDropdownOpen = false;
    buildArticleMap();
    state.articleIds.forEach(id => state.selectedIds.add(id));
    renderArticleList();
    updateSidebarPanels();
    updateVisuStats();
    if (typeof updateHomeMetrics === 'function') updateHomeMetrics();

    setGraphPlaceholderState('Le dataset est charge. Clique sur Generer pour afficher le graphe.');
    const loaded = document.getElementById('file-loaded');
    if (loaded) {
        loaded.style.display = 'block';
        loaded.textContent = `OK ${data.length.toLocaleString()} evenements charges depuis ${sourceLabel}`;
        loaded.style.color = '';
    }

    state.visuChartsBuilt = false;
    state.treemapBuilt = false;

    if (document.getElementById('page-visu')?.classList.contains('active')) {
        buildVisuCharts();
        if (typeof resizeVisuCharts === 'function') resizeVisuCharts();
        if (typeof buildTreemap === 'function') buildTreemap();
    }

    if (document.getElementById('page-demo')?.classList.contains('active') && typeof generateGraph === 'function') {
        generateGraph();
    }

    if (options.share !== false && window.PrevyoSharedDataset) {
        window.PrevyoSharedDataset.saveData(data, sourceLabel);
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

function tryLoadSharedDataset() {
    if (!window.PrevyoSharedDataset) return false;
    const shared = window.PrevyoSharedDataset.read();
    if (!shared || !shared.data) return false;
    processData(shared.data, shared.sourceLabel || 'Dataset partage', { share: false });
    return true;
}

async function autoLoadDefaultData() {
    const embedded = getEmbeddedDefaultData();
    if (embedded) {
        processData(embedded, 'data/fictif_events.json');
        return;
    }

    const candidates = [
        './data/fictif_events.json',
        'data/fictif_events.json',
        './data/fictif_events.json?v=1'
    ];

    try {
        let lastError = null;

        for (const candidate of candidates) {
            try {
                const response = await fetch(candidate, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                const data = JSON.parse(text);
                processData(data, 'data/fictif_events.json');
                return;
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error('Aucun chemin de chargement valide.');
    } catch (err) {
        const loaded = document.getElementById('file-loaded');
        if (loaded) {
            loaded.textContent = `Impossible de charger automatiquement data/fictif_events.json (${err.message})`;
            loaded.style.color = 'var(--anomaly)';
        }
    }
}

function setGraphPlaceholderState(message, icon = '[]') {
    const placeholder = document.getElementById('graph-placeholder');
    const placeholderText = document.getElementById('graph-placeholder-text');
    const placeholderIcon = document.getElementById('graph-placeholder-icon');

    if (placeholder) placeholder.style.display = 'flex';
    if (placeholderText) placeholderText.innerHTML = message;
    if (placeholderIcon) placeholderIcon.textContent = icon;
}

if (window.PrevyoSharedDataset) {
    window.PrevyoSharedDataset.subscribe(function (payload) {
        if (!payload || !payload.data) return;
        processData(payload.data, payload.sourceLabel || 'Dataset partage', { share: false });
    });
}
