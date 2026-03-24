"""
clustering_advanced.py — Clustering avancé des articles (3 approches)

Approche 1 — NMF Topic Modeling
  TF-IDF sur les contexts fusionnés de chaque article → NMF (k topics)
  Chaque article = vecteur de distribution sur les topics (soft assignment)
  Avantage : topics interprétables, articles multi-thèmes capturés

Approche 2 — Graphe de cooccurrence d'entités → Louvain
  On construit un graphe article↔article :
    - Nœud = article
    - Arête(i, j) = nb de nodes (_id) partagés entre les deux articles
  Détection de communautés par algorithme de Louvain (maximisation de la
  modularité). Exploite la vraie structure du graphe de connaissances.

Approche 3 — HDBSCAN optimisé
  Grid search sur min_cluster_size ∈ [3, 5, 8, 10, 15]
  Évaluation objective : Silhouette score + Davies-Bouldin + % clustered
  On retient le meilleur paramétrage.

Comparaison finale :
  Dashboard HTML avec les 3 approches côte à côte.
"""

import json
import numpy as np
import pandas as pd
import networkx as nx
import community as louvain_lib           # python-louvain
from pathlib import Path
from collections import defaultdict, Counter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import NMF
from sklearn.preprocessing import normalize
from sklearn.metrics import silhouette_score, davies_bouldin_score
import umap
import hdbscan as hdbscan_lib
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# ── Config ────────────────────────────────────────────────────────────────────
BASE        = Path("/Users/mekkiryan/Desktop/marathon_web")
INPUT_FILE  = BASE / "export.events.json"
EMBED_CACHE = BASE / "embeddings.npy"
OUTPUT_HTML = BASE / "clustering_advanced.html"
OUTPUT_CSV  = BASE / "clustering_advanced.csv"

NMF_N_TOPICS  = 20     # nb de topics NMF
HDBSCAN_GRID  = [3, 5, 8, 10, 15]   # valeurs à tester
LOUVAIN_SIM   = 2      # nb minimum de nodes partagés pour créer une arête

FRENCH_STOPWORDS = {
    "le","la","les","de","du","des","un","une","en","et","est","il","elle",
    "ils","elles","nous","vous","on","se","sa","son","ses","leur","leurs",
    "que","qui","ne","pas","par","sur","dans","au","aux","ce","cet","cette",
    "ces","ou","où","mais","donc","car","ni","or","si","à","y","très",
    "plus","bien","tout","tous","aussi","après","avant","lors","depuis","été",
    "être","avoir","fait","avec","pour","sans","sous","entre","vers","chez",
    "dont","même","comme","selon","déjà","ont","doit","peut","sont","était",
    "sera","serait","avait","qu","deux","trois","quatre","cinq","dix",
}

EDGE_TYPES = [
    "Theme","TimeMax","Location","Agent","TimeMin","Addition","TimeExact",
    "Time","Topic","Pivot","Patient","Purpose","ArgumentOut","ArgumentIn","Recipient",
]
# ─────────────────────────────────────────────────────────────────────────────


def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

def type_l3(type_str):
    parts = [p for p in (type_str or "").split("/") if p]
    if len(parts) >= 3: return parts[2]
    if len(parts) == 2: return parts[1]
    return parts[0] if parts else "Inconnu"


# ── Chargement ────────────────────────────────────────────────────────────────
print("=" * 60)
print("Chargement...")
with open(INPUT_FILE, encoding="utf-8") as f:
    events = json.load(f)
n_events = len(events)
emb = np.load(str(EMBED_CACHE)).astype("float32")

# ── Reconstruction articles ───────────────────────────────────────────────────
print("Reconstruction articles (resultAnalyseId)...")
groups = defaultdict(list)
for i, e in enumerate(events):
    groups[e.get("resultAnalyseId") or get_id(e)].append(i)

articles = []
emb_art  = []

for aid, idxs in groups.items():
    evts = [events[i] for i in idxs]

    # Embedding article = moyenne re-normalisée
    ae = emb[idxs].mean(axis=0)
    ae /= np.linalg.norm(ae) + 1e-8

    # Nodes et edges fusionnés
    nodes_by_id = {n["_id"]: n for e in evts for n in e.get("nodes", [])}
    edges_by_id = {ed["_id"]: ed for e in evts for ed in e.get("edges", [])}
    all_nodes = list(nodes_by_id.values())
    all_edges = list(edges_by_id.values())

    # Distribution edge types
    et_count = Counter(ed.get("type","") for ed in all_edges)
    edge_vec = np.array([et_count.get(t, 0) for t in EDGE_TYPES], dtype="float32")

    # Context fusionné (tous les events de l'article)
    ctx_parts = [e.get("context","").strip() for e in evts if e.get("context","").strip()]
    full_ctx  = " ".join(ctx_parts)

    # Types
    types_l3 = [type_l3(e.get("type","")) for e in evts]
    dom_type  = Counter(types_l3).most_common(1)[0][0]

    articles.append({
        "article_id"   : aid,
        "n_events"     : len(idxs),
        "n_nodes"      : len(all_nodes),
        "n_edges"      : len(all_edges),
        "node_ids"     : set(nodes_by_id.keys()),
        "dominant_type": dom_type,
        "has_risk"     : int(any(e.get("risk") for e in evts)),
        "has_subdomain": int(any(e.get("subdomain") for e in evts)),
        "edge_vec"     : edge_vec,
        "context"      : full_ctx,
    })
    emb_art.append(ae)

emb_art = np.array(emb_art, dtype="float32")
n_art   = len(articles)
print(f"  {n_art} articles reconstruits")

# Features pour HDBSCAN (même que cluster_articles.py)
from sklearn.preprocessing import StandardScaler
struct_mat = np.array([
    [a["n_events"], a["n_nodes"], a["n_edges"], a["has_risk"], a["has_subdomain"]]
    + a["edge_vec"].tolist()
    for a in articles
], dtype="float32")
struct_scaled = StandardScaler().fit_transform(struct_mat)
X = np.hstack([emb_art, struct_scaled])

print("UMAP 50D (base commune pour HDBSCAN)...")
reducer = umap.UMAP(n_components=50, random_state=42, n_jobs=1,
                     n_neighbors=15, min_dist=0.0)
X_50d = reducer.fit_transform(X)

print("UMAP 2D (pour visualisation)...")
X_2d = umap.UMAP(n_components=2, random_state=42, n_jobs=1,
                  n_neighbors=15, min_dist=0.1).fit_transform(X_50d)


# ══════════════════════════════════════════════════════════════════════════════
# APPROCHE 1 — NMF TOPIC MODELING
# ══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print(f"Approche 1 — NMF Topic Modeling ({NMF_N_TOPICS} topics)...")

contexts = [a["context"] for a in articles]
tfidf = TfidfVectorizer(
    max_features=5000, min_df=2, sublinear_tf=True,
    stop_words=list(FRENCH_STOPWORDS),
    ngram_range=(1, 2),   # unigrammes + bigrammes pour plus de précision
)
C = tfidf.fit_transform(contexts)

nmf = NMF(n_components=NMF_N_TOPICS, random_state=42, max_iter=500)
W = nmf.fit_transform(C)    # (n_articles, n_topics) : distribution article→topics
H = nmf.components_         # (n_topics, vocab)     : distribution topic→mots

# Mots-clés par topic
vocab = tfidf.get_feature_names_out()
topic_labels = []
for t in range(NMF_N_TOPICS):
    top_words = vocab[H[t].argsort()[::-1][:4]]
    topic_labels.append(" | ".join(top_words))
    print(f"  Topic {t:2d}: {topic_labels[-1]}")

# Assignation : topic dominant de chaque article
nmf_labels = W.argmax(axis=1)
nmf_scores  = W.max(axis=1)   # force d'appartenance au topic dominant

# Silhouette score NMF (sur embeddings originaux)
nmf_sil = silhouette_score(emb_art, nmf_labels, metric="cosine", sample_size=500)
print(f"\n  Silhouette NMF (cosine) : {nmf_sil:.4f}")
print(f"  Distribution topics : {Counter(nmf_labels).most_common(5)}")


# ══════════════════════════════════════════════════════════════════════════════
# APPROCHE 2 — GRAPHE D'ENTITÉS → LOUVAIN
# ══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print("Approche 2 — Graphe de cooccurrence d'entités → Louvain...")

# Construire le graphe article-article pondéré par nodes partagés
G = nx.Graph()
G.add_nodes_from(range(n_art))

# Index inverse : node_id → liste d'articles qui le contiennent
node_to_arts = defaultdict(set)
for i, a in enumerate(articles):
    for nid in a["node_ids"]:
        node_to_arts[nid].add(i)

# Pour chaque node partagé, ajouter/incrémenter le poids de l'arête
edge_weights = defaultdict(int)
for nid, art_set in node_to_arts.items():
    art_list = list(art_set)
    if len(art_list) < 2:
        continue
    for k in range(len(art_list)):
        for l in range(k + 1, len(art_list)):
            i, j = art_list[k], art_list[l]
            edge_weights[(min(i,j), max(i,j))] += 1

# N'ajouter que les arêtes avec assez de nodes partagés (filtre bruit)
n_edges_added = 0
for (i, j), w in edge_weights.items():
    if w >= LOUVAIN_SIM:
        G.add_edge(i, j, weight=w)
        n_edges_added += 1

print(f"  Graphe : {G.number_of_nodes()} nœuds · {n_edges_added} arêtes")
print(f"  Composantes connexes : {nx.number_connected_components(G)}")

# Louvain community detection
partition = louvain_lib.best_partition(G, weight="weight", random_state=42)
louvain_labels = np.array([partition.get(i, -1) for i in range(n_art)])

n_comm = len(set(louvain_labels))
isolated = (louvain_labels == -1).sum()
print(f"  {n_comm} communautés · {isolated} articles isolés (pas dans le graphe)")

# Silhouette score Louvain (articles dans le graphe seulement)
mask_conn = np.array([G.degree(i) > 0 for i in range(n_art)])
if mask_conn.sum() > 50:
    louv_sil = silhouette_score(
        emb_art[mask_conn], louvain_labels[mask_conn], metric="cosine", sample_size=500
    )
    print(f"  Silhouette Louvain (cosine, articles connectés) : {louv_sil:.4f}")

# Distribution top communautés
top_comm = Counter(louvain_labels[mask_conn]).most_common(5)
print(f"  Top 5 communautés : {top_comm}")

# Labels TF-IDF pour chaque communauté Louvain
def tfidf_kw(texts, n=3):
    texts = [t for t in texts if t and len(t) > 10]
    if not texts: return f"comm_?"
    try:
        v = TfidfVectorizer(max_features=2000, min_df=1, sublinear_tf=True,
                             stop_words=list(FRENCH_STOPWORDS))
        X_ = v.fit_transform(texts)
        s  = X_.mean(axis=0).A1
        return " | ".join(v.get_feature_names_out()[s.argsort()[::-1][:n]])
    except: return "?"

louvain_kw = {}
for c in sorted(set(louvain_labels)):
    if c == -1: louvain_kw[c] = "isolé"; continue
    idxs_c = [i for i in range(n_art) if louvain_labels[i] == c]
    texts  = [articles[i]["context"] for i in idxs_c if articles[i]["context"]]
    louvain_kw[c] = tfidf_kw(texts)


# ══════════════════════════════════════════════════════════════════════════════
# APPROCHE 3 — HDBSCAN GRID SEARCH
# ══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print(f"Approche 3 — HDBSCAN grid search sur {HDBSCAN_GRID}...")

results = []
for mcs in HDBSCAN_GRID:
    cl = hdbscan_lib.HDBSCAN(min_cluster_size=mcs, core_dist_n_jobs=1)
    lbl = cl.fit_predict(X_50d)
    n_cl   = len(set(lbl)) - (1 if -1 in lbl else 0)
    n_ns   = int((lbl == -1).sum())
    pct_cl = round((1 - n_ns / n_art) * 100, 1)

    # Silhouette uniquement sur les articles clusterisés
    mask = lbl != -1
    sil = (silhouette_score(emb_art[mask], lbl[mask], metric="cosine", sample_size=min(500, mask.sum()))
           if mask.sum() > 50 else 0.0)
    dbi = (davies_bouldin_score(emb_art[mask], lbl[mask])
           if mask.sum() > 50 and n_cl > 1 else 99.0)

    results.append({
        "min_cluster_size": mcs,
        "n_clusters": n_cl,
        "n_noise": n_ns,
        "pct_clustered": pct_cl,
        "silhouette": round(sil, 4),
        "davies_bouldin": round(dbi, 4),
        "labels": lbl,
    })
    print(f"  mcs={mcs:2d} → {n_cl:3d} clusters · {pct_cl}% clustered · "
          f"silhouette={sil:.4f} · DBI={dbi:.4f}")

# Meilleur paramètre = silhouette max
best = max(results, key=lambda r: r["silhouette"])
print(f"\n  Meilleur : min_cluster_size={best['min_cluster_size']} "
      f"(silhouette={best['silhouette']})")
hdbscan_labels = best["labels"]

# Labels TF-IDF pour le meilleur HDBSCAN
hdbscan_kw = {-1: "non-clustere"}
for c in sorted(set(hdbscan_labels)):
    if c == -1: continue
    texts = [articles[i]["context"] for i in range(n_art)
             if hdbscan_labels[i] == c and articles[i]["context"]]
    hdbscan_kw[c] = tfidf_kw(texts)


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT CSV
# ══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print("Export CSV...")
rows = []
for i, a in enumerate(articles):
    rows.append({
        "article_id"      : a["article_id"],
        "n_events"        : a["n_events"],
        "dominant_type"   : a["dominant_type"],
        # NMF
        "nmf_topic"       : int(nmf_labels[i]),
        "nmf_label"       : topic_labels[nmf_labels[i]],
        "nmf_score"       : round(float(nmf_scores[i]), 4),
        # Louvain
        "louvain_community": int(louvain_labels[i]),
        "louvain_label"   : louvain_kw.get(int(louvain_labels[i]), "?"),
        # HDBSCAN optimisé
        "hdbscan_cluster" : int(hdbscan_labels[i]),
        "hdbscan_label"   : hdbscan_kw.get(int(hdbscan_labels[i]), "?"),
        "x_2d"            : round(float(X_2d[i, 0]), 4),
        "y_2d"            : round(float(X_2d[i, 1]), 4),
    })

df = pd.DataFrame(rows)
df.to_csv(OUTPUT_CSV, index=False)
print(f"  {OUTPUT_CSV.name}")


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD HTML
# ══════════════════════════════════════════════════════════════════════════════
print("Dashboard HTML...")

# ── Fig 1 : Comparaison HDBSCAN grid search ──
df_res = pd.DataFrame([{k: v for k, v in r.items() if k != "labels"} for r in results])
fig_grid = make_subplots(specs=[[{"secondary_y": True}]])
fig_grid.add_trace(go.Bar(
    x=df_res["min_cluster_size"].astype(str),
    y=df_res["n_clusters"],
    name="Nb clusters",
    marker_color="#3498db",
), secondary_y=False)
fig_grid.add_trace(go.Scatter(
    x=df_res["min_cluster_size"].astype(str),
    y=df_res["silhouette"],
    name="Silhouette",
    mode="lines+markers",
    marker=dict(size=10, color="#e74c3c"),
    line=dict(width=2),
), secondary_y=True)
fig_grid.add_trace(go.Scatter(
    x=df_res["min_cluster_size"].astype(str),
    y=df_res["pct_clustered"],
    name="% clustered",
    mode="lines+markers",
    marker=dict(size=10, color="#27ae60"),
    line=dict(width=2, dash="dot"),
), secondary_y=True)
fig_grid.update_layout(
    title="<b>HDBSCAN grid search</b> — Nb clusters · Silhouette · % articles clustered",
    xaxis_title="min_cluster_size",
    plot_bgcolor="white",
    paper_bgcolor="white",
    height=400,
    legend=dict(orientation="h", y=1.1),
)
fig_grid.update_yaxes(title_text="Nb clusters", secondary_y=False)
fig_grid.update_yaxes(title_text="Score / %", secondary_y=True)

# ── Fig 2 : Scatter 2D — HDBSCAN ──
df_plot = pd.DataFrame({
    "x": X_2d[:, 0], "y": X_2d[:, 1],
    "hdbscan": [str(hdbscan_labels[i]) for i in range(n_art)],
    "nmf_topic": [f"Topic {nmf_labels[i]}" for i in range(n_art)],
    "louvain": [f"Comm {louvain_labels[i]}" for i in range(n_art)],
    "label_h": [hdbscan_kw.get(int(hdbscan_labels[i]), "?") for i in range(n_art)],
    "label_n": [topic_labels[nmf_labels[i]] for i in range(n_art)],
    "label_l": [louvain_kw.get(int(louvain_labels[i]), "?") for i in range(n_art)],
    "context": [a["context"][:100] for a in articles],
    "n_events": [a["n_events"] for a in articles],
})

def scatter_2d(color_col, label_col, title, height=500):
    fig = px.scatter(
        df_plot, x="x", y="y",
        color=color_col,
        hover_data={
            label_col: True, "context": True, "n_events": True,
            "x": False, "y": False, color_col: False,
        },
        title=title,
        height=height, width=700,
    )
    fig.update_traces(marker=dict(size=5, opacity=0.65))
    fig.update_layout(
        plot_bgcolor="white", paper_bgcolor="white",
        showlegend=False,
        margin=dict(t=50, l=10, r=10, b=10),
        xaxis=dict(visible=False), yaxis=dict(visible=False),
    )
    return fig

fig_hdb  = scatter_2d("hdbscan",  "label_h",
    f"<b>HDBSCAN</b> (mcs={best['min_cluster_size']}) — "
    f"{best['n_clusters']} clusters · sil={best['silhouette']}")
fig_nmf  = scatter_2d("nmf_topic", "label_n",
    f"<b>NMF Topic Modeling</b> — {NMF_N_TOPICS} topics · sil={nmf_sil:.4f}")
fig_louv = scatter_2d("louvain",  "label_l",
    f"<b>Louvain</b> — {n_comm} communautés · "
    f"{n_edges_added} arêtes (nodes partagés ≥ {LOUVAIN_SIM})")

# ── Fig 3 : Topics NMF — top mots ──
topic_rows = []
for t in range(NMF_N_TOPICS):
    top5 = vocab[H[t].argsort()[::-1][:6]]
    n_arts = (nmf_labels == t).sum()
    topic_rows.append({"topic": f"T{t}", "label": " | ".join(top5[:3]),
                        "n_articles": n_arts, "top_words": " | ".join(top5)})

df_topics = pd.DataFrame(topic_rows).sort_values("n_articles", ascending=True)
fig_nmf_bar = px.bar(
    df_topics, x="n_articles", y="topic", orientation="h",
    text="label", color="n_articles", color_continuous_scale="Purples",
    title=f"<b>Topics NMF</b> — nb d'articles par topic (mots-clés TF-IDF)",
    height=600,
)
fig_nmf_bar.update_traces(textposition="outside", textfont=dict(size=10))
fig_nmf_bar.update_layout(
    plot_bgcolor="white", paper_bgcolor="white",
    coloraxis_showscale=False,
    margin=dict(t=50, l=80, r=150, b=10),
    yaxis=dict(tickfont=dict(size=11)),
)

# ── Assemblage HTML ──
stats = f"""
<div style="font-family:Arial;background:#f0f4f8;border-left:4px solid #8e44ad;
     padding:14px 22px;margin:16px 0;border-radius:4px;
     display:flex;gap:36px;flex-wrap:wrap;font-size:14px;">
  <div><b style="font-size:22px;color:#8e44ad">{n_art}</b><br><small>articles</small></div>
  <div><b style="font-size:22px;color:#3498db">{best['n_clusters']}</b>
       <br><small>clusters HDBSCAN (mcs={best['min_cluster_size']})</small></div>
  <div><b style="font-size:22px;color:#9b59b6">{NMF_N_TOPICS}</b>
       <br><small>topics NMF</small></div>
  <div><b style="font-size:22px;color:#27ae60">{n_comm}</b>
       <br><small>communautés Louvain</small></div>
  <div><b style="font-size:22px;color:#e67e22">{n_edges_added:,}</b>
       <br><small>arêtes graphe entités</small></div>
  <div><b style="font-size:22px;color:#e74c3c">{best['silhouette']:.4f}</b>
       <br><small>silhouette HDBSCAN (meilleur)</small></div>
</div>"""

scatter_row = f"""
<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:30px;">
  <div style="flex:1;min-width:600px">{fig_hdb.to_html(full_html=False,include_plotlyjs=False)}</div>
  <div style="flex:1;min-width:600px">{fig_nmf.to_html(full_html=False,include_plotlyjs=False)}</div>
</div>
<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:30px;">
  <div style="flex:1;min-width:600px">{fig_louv.to_html(full_html=False,include_plotlyjs=False)}</div>
  <div style="flex:1;min-width:600px">{fig_nmf_bar.to_html(full_html=False,include_plotlyjs=False)}</div>
</div>"""

html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Clustering Avancé — Marathon du Web</title>
  <style>
    body{{font-family:Arial,sans-serif;background:#fff;margin:28px 36px;}}
    h1{{color:#1a1a2e;font-size:21px;margin-bottom:3px;}}
    p.sub{{color:#666;font-size:13px;margin:0 0 16px 0;}}
    h2{{font-size:15px;color:#444;border-bottom:2px solid #eee;
        padding-bottom:5px;margin:28px 0 10px 0;}}
  </style>
</head>
<body>
  <h1>Clustering avancé — 3 approches comparées</h1>
  <p class="sub">
    HDBSCAN optimisé · NMF Topic Modeling · Louvain sur graphe d'entités partagées
  </p>
  {stats}
  <h2>Optimisation HDBSCAN — Grid search</h2>
  {fig_grid.to_html(full_html=False, include_plotlyjs=True)}
  <h2>Comparaison visuelle — UMAP 2D (même projection, coloriages différents)</h2>
  <p style="font-size:13px;color:#666;margin-top:-6px">
    Chaque point = 1 article · Couleur = cluster selon chaque méthode · Hover pour détails
  </p>
  {scatter_row}
</body>
</html>"""

with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\nDashboard -> {OUTPUT_HTML.name}")
print("Termine.")
