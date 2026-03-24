---
output:
  html_document: default
  pdf_document: default
---
# Marathon du Web 2025 — EMVISTA / PREVYO
## Rapport technique — Équipe MIASHS

---

## Contexte

**Entreprise :** EMVISTA — solution PREVYO
**Dataset :** 11 948 events JSON extraits automatiquement par NLP depuis des articles de presse
**Objectif :** Analyser la base de connaissances pour détecter des anomalies et regrouper les articles similaires

---

## Structure des données

Chaque document JSON est un **EventEntity** : un micro-événement extrait d'un texte source.

```
EventEntity
├── _id, createdAt, resultAnalyseId, taskId
├── type          → taxonomie hiérarchique : Thing/Abstract/Event/Win
├── subdomain     → Thing/Abstract/Domain/Digital  (optionnel)
├── risk          → Thing/Abstract/Risk/Societal    (optionnel)
├── sourceNodeId  → _id du node verbe racine de l'événement
├── context       → extrait de l'article source
├── nodes[]       → entités linguistiques (verbes, noms, dates...)
│   ├── _id, form (mot brut), labels (ontologie)
│   └── properties : tense, polarity, aspect, mood...
└── edges[]       → relations sémantiques entre nodes
    ├── type : Theme, Agent, Location, Time, TimeMin, TimeMax...
    └── source → target (ids de nodes)
```

**Clé de reconstruction d'article :** `resultAnalyseId`
Tous les events qui partagent le même `resultAnalyseId` proviennent du même article.
→ 11 948 events → **2 273 articles** (ratio moyen : 5,26 events/article)

**Structure en étoile :** le `sourceNodeId` désigne le verbe racine. Les edges partent de ce verbe vers les acteurs (Agent), lieux (Location), dates (Time/TimeMin/TimeMax), objets (Theme/Patient).

---

## Axe 1 — Détection d'anomalies

**Fichiers :** `anomalies.py` → `anomalies.csv` + `events_anomalies.json`

### Représentation de chaque event

| Composante | Dimension | Description |
|---|---|---|
| Embedding MiniLM | 384 | Embedding du champ `context` (paraphrase-multilingual-MiniLM-L12-v2) |
| Features structurelles | 5 | nb_nodes, nb_edges, nb_edge_types, nb_node_labels, profondeur taxonomique |
| One-hot taxonomique | ~13 | Encodage des 3 premiers niveaux du type (Thing / Abstract / Event) |
| **Total** | **~402** | Matrice X normalisée (StandardScaler) |

### Pipeline de détection

**Étape 1 — Isolation Forest**
- Algorithme de détection d'anomalies globales basé sur la profondeur d'isolation des points
- Paramètre : `contamination = 0.05` (5% d'anomalies attendues)
- Score IF ∈ [0, 1] après normalisation min-max (1 = très anormal)

**Étape 2 — Score local k-NN**
- Pour chaque event, calcul de la similarité cosinus moyenne avec ses k=10 plus proches voisins **dans le même groupe taxonomique** (3 premiers niveaux du type)
- Events groupés par préfixe taxonomique pour comparer ce qui est comparable
- Score local = 1 − similarité_normalisée (1 = sémantiquement isolé dans son groupe)

**Étape 3 — Score composite**
```
score_final = 0.6 × score_IF + 0.4 × score_local
```

**Niveaux d'alerte :**
| Niveau | Seuil | Nb events |
|---|---|---|
| 🔴 Critique | score > 0.80 | **13** |
| 🟠 Suspect  | 0.55 < score ≤ 0.80 | **2 110** |
| 🟢 Normal   | score ≤ 0.55 | **9 825** |

### Explicabilité

Chaque event anormal reçoit un message en langage naturel :
- Type très rare (< 5 occurrences dans le dataset)
- Aucun nœud dans l'event
- Nombre de nœuds inhabituel (> 95e percentile)
- Aucune arête malgré plusieurs nœuds
- Contexte sémantiquement isolé dans son groupe taxonomique

---

## Axe 2 — Similarité et clustering

**Fichiers :** `cluster_articles.py` → `articles_clustering.csv` + `dashboard_articles.html`

### Étape 1 — Reconstruction des articles

Groupement par `resultAnalyseId` :
- Nodes fusionnés (dédupliqués par `_id`)
- Edges fusionnés (dédupliqués par `_id`)
- Embedding article = **moyenne des embeddings** de ses events (re-normalisée)

### Étape 2 — Représentation des articles

| Composante | Dimension | Description |
|---|---|---|
| Embedding moyen | 384 | Moyenne des embeddings MiniLM des events de l'article |
| Features structurelles | 20 | n_events, n_nodes, n_edges, has_risk, has_subdomain + distribution des 15 edge types (Theme, Agent, Location, TimeMax, TimeMin, Addition, TimeExact, Time, Topic, Pivot, Patient, Purpose, ArgumentOut, ArgumentIn, Recipient) |
| **Total** | **404** | Normalisé (StandardScaler) |

### Étape 3 — Clustering

```
Features (404D) → UMAP (50D) → HDBSCAN → labels TF-IDF
```

- **UMAP** : réduction à 50 dimensions en préservant la structure locale (`n_neighbors=15`, `min_dist=0.0`)
- **HDBSCAN** : clustering hiérarchique par densité, robuste au bruit (`min_cluster_size=3`)
- **Labels TF-IDF** : 3 mots-clés extraits des contexts de chaque cluster (stop words français filtrés)

**Résultats :**
| Métrique | Valeur |
|---|---|
| Articles analysés | 2 273 |
| Clusters thématiques | **144** |
| Articles isolés (hors cluster) | 496 |
| Top cluster | 282 articles — *président \| mercredi \| trump* |

### Étape 4 — Quasi-doublons

**Fichier :** `clustering.py` → `quasi_doublons.csv`

Score de similarité entre deux events :
```
Sij = 0.6 × cosine(embedding_i, embedding_j)
    + 0.4 × sim_structure(i, j)

sim_structure = 0.50 × similarité_taxonomique
              + 0.30 × Jaccard(node_labels_i, node_labels_j)
              + 0.20 × Jaccard(edge_types_i, edge_types_j)
```

- Seuil quasi-doublon : **Sij > 0.90**
- Calcul par batchs de 500 (pré-filtre cosinus > 0.80 pour efficacité)
- **1 727 paires quasi-doublons** détectées

---

## Application Streamlit

**Fichier :** `app.py` — lancé avec `streamlit run app.py`

| Vue | Contenu |
|---|---|
| 📊 Tableau de bord | 6 KPIs · Camembert anomalies · Top types · Histogramme des scores |
| 🚨 Anomalies | Filtres niveau/score/mot-clé · Tableau coloré · Détail par event |
| 🔗 Similarité | Treemap + Bubble chart des clusters · Tableau quasi-doublons |
| 🔎 Exploration | Recherche plein texte · Détail nodes/edges · JSON brut |

---

## Stack technique

| Outil | Usage |
|---|---|
| `sentence-transformers` (MiniLM-L12-v2) | Embeddings multilingues |
| `scikit-learn` | Isolation Forest, StandardScaler, TF-IDF |
| `umap-learn` | Réduction de dimension |
| `hdbscan` | Clustering par densité |
| `numpy` / `pandas` | Traitement des données |
| `plotly` | Visualisations interactives |
| `streamlit` | Application web |

## Fichiers produits

| Fichier | Description |
|---|---|
| `embeddings.npy` | Cache des embeddings (11 948 × 384, float32) |
| `anomalies.csv` | Score et niveau de chaque event, trié par score décroissant |
| `events_anomalies.json` | Events annotés avec `anomaly_score`, `anomaly_niveau`, `anomaly_explication` |
| `articles_clustering.csv` | Un article par ligne, avec cluster_id et cluster_label |
| `quasi_doublons.csv` | 1 727 paires avec cosine, sim_structure, Sij |
| `dashboard_articles.html` | Treemap + bubble chart interactifs |
| `app.py` | Application Streamlit 4 vues |
