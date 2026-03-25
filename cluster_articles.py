"""
cluster_articles.py — Clustering au niveau article (Axe 2 corrigé)

Clé de regroupement : resultAnalyseId (tous les events d'un même article
partagent le même resultAnalyseId).

Résultat : 2273 articles reconstruits depuis 11948 events (ratio ~5.26).

Représentation de chaque article :
  - Embedding     : moyenne des embeddings MiniLM de ses events
  - Structurel    : distribution des edge types (Theme, Agent, Location…)
                    + présence risk/subdomain + n_events + n_nodes + n_edges
  - Taxonomique   : diversité des types d'events (one-hot niveau 3)

Pipeline :
  1. Reconstruction des articles via resultAnalyseId
  2. Features article (embedding + structural + taxonomic)
  3. UMAP 50D → HDBSCAN → labels TF-IDF
  4. Dashboard HTML (treemap + bubble chart)
  5. Export CSV annoté
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict, Counter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
import umap
import hdbscan as hdbscan_lib
import plotly.express as px
import plotly.graph_objects as go

# ── Config ────────────────────────────────────────────────────────────────────
BASE        = Path("/Users/mekkiryan/Desktop/marathon_web")
INPUT_FILE  = BASE / "export.events.json"
EMBED_CACHE = BASE / "embeddings.npy"
OUTPUT_HTML = BASE / "dashboard_articles.html"
OUTPUT_CSV  = BASE / "articles_clustering.csv"

HDBSCAN_MIN = 3
N_KEYWORDS  = 3
TOP_TREEMAP = 60
TOP_BUBBLE  = 25

# Edge types connus (pour le vecteur de distribution)
EDGE_TYPES = [
    "Theme", "TimeMax", "Location", "Agent", "TimeMin",
    "Addition", "TimeExact", "Time", "Topic", "Pivot",
    "Patient", "Purpose", "ArgumentOut", "ArgumentIn", "Recipient",
]

FRENCH_STOPWORDS = {
    "le","la","les","de","du","des","un","une","en","et","est","il","elle",
    "ils","elles","nous","vous","on","se","sa","son","ses","leur","leurs",
    "que","qui","ne","pas","par","sur","dans","au","aux","ce","cet","cette",
    "ces","ou","où","mais","donc","car","ni","or","si","à","y","très",
    "plus","bien","tout","tous","aussi","après","avant","lors","depuis","été",
    "être","avoir","fait","avec","pour","sans","sous","entre","vers","chez",
    "dont","même","comme","selon","déjà",
    # verbes auxiliaires et mots très fréquents mal filtrés
    "ont","doit","peut","faut","doit","sont","était","sera","serait",
    "avait","qu","qu'","c'est","s'est","n'est","l'on","l'","d'un","d'une",
    "deux","trois","quatre","cinq","six","sept","huit","neuf","dix",
    "dont","cette","tout","toute","toutes","tous",
}
# ─────────────────────────────────────────────────────────────────────────────


def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

def type_l3(type_str):
    parts = [p for p in (type_str or "").split("/") if p]
    if len(parts) >= 3: return parts[2]
    if len(parts) == 2: return parts[1]
    return parts[0] if parts else "Inconnu"

def tfidf_keywords(texts, n=3):
    texts = [t for t in texts if t and len(t) > 10]
    if not texts:
        return []
    try:
        vec = TfidfVectorizer(
            max_features=3000, min_df=1, sublinear_tf=True,
            stop_words=list(FRENCH_STOPWORDS),
        )
        X      = vec.fit_transform(texts)
        scores = X.mean(axis=0).A1
        top    = scores.argsort()[::-1][:n]
        return [vec.get_feature_names_out()[i] for i in top]
    except Exception:
        return []


# ── 1. Chargement ─────────────────────────────────────────────────────────────
print("Chargement...")
with open(INPUT_FILE, encoding="utf-8") as f:
    events = json.load(f)
n_events = len(events)
print(f"  {n_events} events.")

emb = np.load(str(EMBED_CACHE)).astype("float32")
assert emb.shape[0] == n_events


# ── 2. Reconstruction des articles ────────────────────────────────────────────
print("Reconstruction des articles via resultAnalyseId...")

groups = defaultdict(list)   # resultAnalyseId → [indices]
for i, e in enumerate(events):
    aid = e.get("resultAnalyseId") or get_id(e)
    groups[aid].append(i)

n_articles = len(groups)
print(f"  {n_articles} articles · ratio moyen {n_events/n_articles:.2f} events/article")

# Pour chaque article : fusionner les données
articles      = []
art_emb_list  = []

for aid, idxs in groups.items():
    evts = [events[i] for i in idxs]

    # Embedding article = moyenne des embeddings de ses events (re-normalisé)
    art_emb = emb[idxs].mean(axis=0)
    art_emb /= np.linalg.norm(art_emb) + 1e-8

    # Nodes fusionnés (dédupliqués par _id)
    nodes_by_id = {}
    for e in evts:
        for n in e.get("nodes", []):
            nodes_by_id[n["_id"]] = n

    # Edges fusionnés (dédupliqués par _id)
    edges_by_id = {}
    for e in evts:
        for ed in e.get("edges", []):
            edges_by_id[ed["_id"]] = ed

    all_nodes = list(nodes_by_id.values())
    all_edges = list(edges_by_id.values())

    # Distribution des edge types → vecteur de 15 dimensions
    edge_type_counter = Counter(ed.get("type", "") for ed in all_edges)
    edge_vec = np.array([edge_type_counter.get(t, 0) for t in EDGE_TYPES], dtype="float32")

    # Types d'events (niveau 3) présents dans l'article
    types_l3 = [type_l3(e.get("type", "")) for e in evts]
    dominant_type = Counter(types_l3).most_common(1)[0][0]

    # Champs optionnels : risk et subdomain (présence = 1)
    has_risk     = int(any(e.get("risk") for e in evts))
    has_subdomain = int(any(e.get("subdomain") for e in evts))

    # Contexte : on prend le premier non-vide
    context = next(
        ((e.get("context") or "").strip() for e in evts if e.get("context")),
        ""
    )

    articles.append({
        "article_id"   : aid,
        "n_events"     : len(idxs),
        "n_nodes"      : len(all_nodes),
        "n_edges"      : len(all_edges),
        "dominant_type": dominant_type,
        "types_l3"     : types_l3,
        "has_risk"     : has_risk,
        "has_subdomain": has_subdomain,
        "edge_vec"     : edge_vec,
        "context"      : context,
    })
    art_emb_list.append(art_emb)

emb_art = np.array(art_emb_list, dtype="float32")


# ── 3. Features structurelles ─────────────────────────────────────────────────
print("Construction des features structurelles...")

# Vecteur structurel par article :
# [n_events, n_nodes, n_edges, has_risk, has_subdomain, edge_type_1..15]
struct_mat = np.array([
    [a["n_events"], a["n_nodes"], a["n_edges"],
     a["has_risk"], a["has_subdomain"]]
    + a["edge_vec"].tolist()
    for a in articles
], dtype="float32")

# Normalisation avant concat
scaler     = StandardScaler()
struct_scaled = scaler.fit_transform(struct_mat)

# Features finales = embedding (384) + structurel normalisé (20)
X = np.hstack([emb_art, struct_scaled])
print(f"  Matrice features : {X.shape}  ({n_articles} articles × {X.shape[1]} features)")


# ── 4. UMAP + HDBSCAN ─────────────────────────────────────────────────────────
print("UMAP 50D...")
reducer = umap.UMAP(n_components=50, random_state=42, n_jobs=1,
                     n_neighbors=15, min_dist=0.0)
X_50d = reducer.fit_transform(X)

print(f"HDBSCAN (min_cluster_size={HDBSCAN_MIN})...")
clusterer = hdbscan_lib.HDBSCAN(min_cluster_size=HDBSCAN_MIN, core_dist_n_jobs=1)
labels    = clusterer.fit_predict(X_50d)

n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise    = int((labels == -1).sum())
print(f"  {n_clusters} clusters | {n_noise} articles non-clusteres")


# ── 5. Labels TF-IDF ──────────────────────────────────────────────────────────
print("Labels TF-IDF...")
cluster_keywords = {-1: "non-clustere"}

for c in sorted(set(labels)):
    if c == -1:
        continue
    texts = [articles[i]["context"] for i in range(n_articles)
             if labels[i] == c and articles[i]["context"]]
    kws   = tfidf_keywords(texts, N_KEYWORDS)
    cluster_keywords[c] = " | ".join(kws) if kws else f"cluster_{c}"

top5 = Counter(int(l) for l in labels if l != -1).most_common(5)
print("  Top 5 clusters :")
for c, sz in top5:
    print(f"    [{sz:4d} articles] {cluster_keywords[c]}")


# ── 6. Export CSV ─────────────────────────────────────────────────────────────
rows = []
for i, art in enumerate(articles):
    lbl = int(labels[i])
    rows.append({
        "article_id"    : art["article_id"],
        "n_events"      : art["n_events"],
        "n_nodes"       : art["n_nodes"],
        "n_edges"       : art["n_edges"],
        "dominant_type" : art["dominant_type"],
        "has_risk"      : art["has_risk"],
        "has_subdomain" : art["has_subdomain"],
        "cluster_id"    : lbl,
        "cluster_label" : cluster_keywords.get(lbl, f"cluster_{lbl}"),
        "is_noise"      : lbl == -1,
        "context_120"   : art["context"][:120],
    })

df_csv = pd.DataFrame(rows)
df_csv.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")
print(f"CSV -> {OUTPUT_CSV.name}")


# ── 7. Dashboard HTML ─────────────────────────────────────────────────────────
print("Dashboard HTML...")

cluster_rows = []
for c in sorted(set(labels)):
    if c == -1:
        continue
    idxs_c   = [i for i in range(n_articles) if labels[i] == c]
    dom_types = [articles[i]["dominant_type"] for i in idxs_c]
    dominant  = Counter(dom_types).most_common(1)[0][0]
    exemple   = next((articles[i]["context"][:180]
                       for i in idxs_c if articles[i]["context"]), "")
    avg_events = round(sum(articles[i]["n_events"] for i in idxs_c) / len(idxs_c), 1)
    cluster_rows.append({
        "cluster_id"  : c,
        "label"       : cluster_keywords[c],
        "n_articles"  : len(idxs_c),
        "type_cat"    : dominant,
        "avg_events"  : avg_events,
        "exemple"     : exemple,
    })

df_cl = (pd.DataFrame(cluster_rows)
           .sort_values("n_articles", ascending=False)
           .reset_index(drop=True))

# — Treemap —
df_tree = df_cl.head(TOP_TREEMAP)
fig_tree = px.treemap(
    df_tree,
    path=[px.Constant("Tous les clusters"), "type_cat", "label"],
    values="n_articles",
    color="n_articles",
    color_continuous_scale="Teal",
    color_continuous_midpoint=df_tree["n_articles"].median(),
    hover_data={"avg_events": True, "exemple": True},
    title=(
        f"<b>{n_clusters} clusters thématiques d'articles</b><br>"
        f"<sup>{n_articles} articles · {n_events} events · "
        f"Groupement par resultAnalyseId · UMAP 50D → HDBSCAN</sup>"
    ),
    width=1400, height=700,
)
fig_tree.update_traces(
    textinfo="label+value",
    textfont=dict(size=13),
    hovertemplate=(
        "<b>%{label}</b><br>Articles : <b>%{value}</b><br>"
        "Moy. events/article : %{customdata[0]}<br>"
        "<i>%{customdata[1]}</i><extra></extra>"
    ),
)
fig_tree.update_layout(margin=dict(t=80, l=10, r=10, b=10),
                        font=dict(family="Arial", size=13))

# — Bubble chart —
df_top  = df_cl.head(TOP_BUBBLE).reset_index(drop=True)
N_COLS  = 5
spacing = float(np.sqrt(df_top["n_articles"].max()) * 1.8)
gx      = (df_top.index % N_COLS) * spacing
gy      = -(df_top.index // N_COLS) * spacing

palette = (px.colors.qualitative.Pastel + px.colors.qualitative.Safe
           + px.colors.qualitative.Set3)
colors  = [palette[i % len(palette)] for i in range(len(df_top))]
s_min, s_max = df_top["n_articles"].min(), df_top["n_articles"].max()
sizes   = 30 + 80 * (df_top["n_articles"] - s_min) / max(s_max - s_min, 1)
texts   = df_top["label"].where(df_top["n_articles"] >= 4, "")

fig_bubble = go.Figure(go.Scatter(
    x=gx, y=gy,
    mode="markers+text",
    text=texts,
    textposition="middle center",
    textfont=dict(size=9, color="#222"),
    marker=dict(size=sizes, sizemode="diameter", color=colors,
                opacity=0.88, line=dict(width=2, color="white")),
    customdata=list(zip(
        df_top["label"], df_top["n_articles"],
        df_top["avg_events"], df_top["exemple"],
    )),
    hovertemplate=(
        "<b>%{customdata[0]}</b><br>"
        "Articles : <b>%{customdata[1]}</b> · "
        "Moy. %{customdata[2]} events/article<br>"
        "<i>%{customdata[3]}</i><extra></extra>"
    ),
    showlegend=False,
))
fig_bubble.update_layout(
    title=dict(
        text=(
            f"<b>Top {TOP_BUBBLE} clusters les plus peuplés</b><br>"
            f"<sup>Taille = nb d'articles · Hover pour thème + exemple</sup>"
        ),
        x=0.5, xanchor="center", font=dict(size=16),
    ),
    xaxis=dict(visible=False), yaxis=dict(visible=False),
    plot_bgcolor="white", paper_bgcolor="white",
    width=1400, height=680,
    margin=dict(t=90, l=20, r=20, b=20),
    font=dict(family="Arial", size=13),
)

# — Stats —
n_with_risk = sum(1 for a in articles if a["has_risk"])
n_with_sub  = sum(1 for a in articles if a["has_subdomain"])

stats_banner = f"""
<div style="font-family:Arial,sans-serif;background:#f0f4f8;border-left:4px solid #2a7ae2;
     padding:16px 24px;margin:20px 0 10px 0;border-radius:4px;
     display:flex;gap:40px;flex-wrap:wrap;">
  <div><span style="font-size:28px;font-weight:bold;color:#2a7ae2">{n_events:,}</span>
       <br><small style="color:#555">events dans le dataset</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#16a085">{n_articles:,}</span>
       <br><small style="color:#555">articles reconstruits</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#8e44ad">
       {n_events/n_articles:.1f}</span>
       <br><small style="color:#555">events / article (moy.)</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#27ae60">{n_clusters}</span>
       <br><small style="color:#555">clusters thématiques</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#e67e22">{n_noise}</span>
       <br><small style="color:#555">articles isolés</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#c0392b">{n_with_risk:,}</span>
       <br><small style="color:#555">articles avec risk ({round(n_with_risk/n_articles*100)}%)</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#7f8c8d">{n_with_sub:,}</span>
       <br><small style="color:#555">articles avec subdomain</small></div>
</div>"""

html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Dashboard Articles — Marathon du Web</title>
  <style>
    body {{ font-family:Arial,sans-serif; background:#fff; margin:30px 40px; }}
    h1   {{ color:#1a1a2e; font-size:22px; margin-bottom:4px; }}
    p.sub {{ color:#666; font-size:14px; margin-top:0; margin-bottom:20px; }}
    .section {{ margin-bottom:40px; }}
    .section h2 {{ font-size:16px; color:#444; border-bottom:2px solid #e0e0e0;
                   padding-bottom:6px; margin-bottom:12px; }}
  </style>
</head>
<body>
  <h1>Axe 2 — Clustering sémantique des articles</h1>
  <p class="sub">
    Reconstruction par <code>resultAnalyseId</code> ·
    Features = embedding MiniLM + distribution edge types (Theme/Agent/Location…) ·
    UMAP 50D → HDBSCAN
  </p>
  {stats_banner}
  <div class="section">
    <h2>Vue d'ensemble — Top {TOP_TREEMAP} clusters (cliquer pour zoomer)</h2>
    {fig_tree.to_html(full_html=False, include_plotlyjs=True)}
  </div>
  <div class="section">
    <h2>Top {TOP_BUBBLE} clusters les plus peuplés</h2>
    {fig_bubble.to_html(full_html=False, include_plotlyjs=False)}
  </div>
</body>
</html>"""

with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\nDashboard -> {OUTPUT_HTML.name}")
print("Termine.")
