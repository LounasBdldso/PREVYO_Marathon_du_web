"""
viz_clusters.py — Dashboard de visualisation des clusters (Axe 2)

Lit clustering.csv + events_clustering.json et génère dashboard_clusters.html

Contenu du dashboard (deux sections dans un seul fichier HTML) :

  1. TREEMAP
     Vue d'ensemble de TOUS les clusters.
     Hiérarchie : Catégorie taxonomique → Cluster (mots-clés TF-IDF)
     Taille de chaque rectangle ∝ nombre d'events.
     Cliquer sur une catégorie zoome dedans.

  2. BUBBLE CHART
     Top 25 clusters uniquement (les plus peuplés).
     - axe X   = nombre d'events (position = taille → axe porteur de sens)
     - axe Y   = catégorie taxonomique (type niveau 2)
     - taille  = nombre d'events (redondant mais lisible d'un coup d'œil)
     - couleur = catégorie taxonomique
     - label   = mots-clés TF-IDF (affiché uniquement si cluster > 20 events)
     - hover   = keywords + exemple de context + nb events
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict
import plotly.express as px
import plotly.graph_objects as go

# ── Config ────────────────────────────────────────────────────────────────────
BASE          = Path("/Users/mekkiryan/Desktop/marathon_web")
CLUSTER_CSV   = BASE / "clustering.csv"
EVENTS_JSON   = BASE / "events_clustering.json"
OUTPUT_HTML   = BASE / "dashboard_clusters.html"

TOP_N_TREEMAP = 80   # clusters affichés dans le treemap (les plus peuplés)
TOP_N_BUBBLE  = 25   # clusters affichés dans le bubble chart
LABEL_MIN     = 20   # taille min pour afficher le label dans la bulle
# ─────────────────────────────────────────────────────────────────────────────


def get_type_l2(type_str):
    """
    Niveau 3 de la taxonomie comme catégorie principale.
    Exemple : Thing/Abstract/Event/Win → 'Event'
    Fallback sur niveau 2 puis niveau 1 si manquant.
    """
    parts = [p for p in type_str.split("/") if p]
    if len(parts) >= 3:
        return parts[2]   # niveau 3 : Event, State, Relation…
    if len(parts) == 2:
        return parts[1]   # niveau 2 si pas de niveau 3
    return parts[0] if parts else "Inconnu"


def build_cluster_df(events):
    """
    Construit un DataFrame avec une ligne par cluster :
    cluster_id, label, n_events, type_l2_dominant, exemple
    """
    groups = defaultdict(list)
    for e in events:
        cid = e.get("cluster_id", -1)
        groups[cid].append(e)

    rows = []
    for cid, evts in groups.items():
        if cid == -1:
            continue  # events non-clustérés ignorés ici

        label    = evts[0].get("cluster_label", f"cluster_{cid}")
        n        = len(evts)

        # Type niveau 2 dominant dans le cluster
        t2_counts = defaultdict(int)
        for e in evts:
            t2_counts[get_type_l2(e.get("type", ""))] += 1
        dominant_t2 = max(t2_counts, key=t2_counts.get)

        # Premier context non-vide comme exemple
        exemple = next(
            ((e.get("context") or "")[:180] for e in evts if e.get("context")),
            ""
        )

        rows.append({
            "cluster_id" : cid,
            "label"      : label,
            "n_events"   : n,
            "type_l2"    : dominant_t2,
            "exemple"    : exemple,
        })

    return pd.DataFrame(rows).sort_values("n_events", ascending=False).reset_index(drop=True)


# ── Chargement ────────────────────────────────────────────────────────────────
print("Chargement events_clustering.json...")
with open(EVENTS_JSON, encoding="utf-8") as f:
    events = json.load(f)
n_total = len(events)
n_noise = sum(1 for e in events if e.get("is_noise", False))
n_quasi = sum(1 for e in events if e.get("is_quasi_dup", False))

print("Construction du DataFrame clusters...")
df = build_cluster_df(events)
n_clusters = len(df)
print(f"  {n_clusters} clusters | {n_noise} non-clusterés | {n_quasi} quasi-doublons")


# ── 1. TREEMAP ────────────────────────────────────────────────────────────────
print("Treemap...")

# Palette de couleurs qualitatives pour les catégories
type_order = (
    df.groupby("type_l2")["n_events"].sum()
    .sort_values(ascending=False)
    .index.tolist()
)

df_treemap = df.head(TOP_N_TREEMAP).copy()

fig_tree = px.treemap(
    df_treemap,
    path=[px.Constant("Tous les clusters"), "type_l2", "label"],
    values="n_events",
    color="n_events",
    color_continuous_scale="Teal",
    color_continuous_midpoint=df["n_events"].median(),
    hover_data={"exemple": True, "cluster_id": True, "n_events": True},
    title=(
        f"<b>Vue d'ensemble — {n_clusters} clusters thématiques</b><br>"
        f"<sup>{n_total} events · {n_noise} non-clusterés · "
        f"Regroupement : catégorie taxonomique → thème (TF-IDF)</sup>"
    ),
    width=1400,
    height=720,
)
fig_tree.update_traces(
    textinfo="label+value",
    textfont=dict(size=13),
    hovertemplate=(
        "<b>%{label}</b><br>"
        "Events : <b>%{value}</b><br>"
        "<i>%{customdata[0]}</i>"
        "<extra></extra>"
    ),
)
fig_tree.update_layout(
    margin=dict(t=80, l=10, r=10, b=10),
    font=dict(family="Arial", size=13),
    coloraxis_colorbar=dict(title="Events", thickness=15),
)


# ── 2. BUBBLE CHART ───────────────────────────────────────────────────────────
# Layout en grille : les bulles sont posées librement dans un espace 2D.
# La position X/Y n'a pas de sens — seule la taille compte.
# On évite ainsi le problème "tout sur une ligne" causé par une seule catégorie.
# Les bulles sont triées par taille décroissante et disposées ligne par ligne
# (plus grande en haut à gauche, comme un mur de photos).
print(f"Bubble chart (top {TOP_N_BUBBLE})...")

df_top = df.head(TOP_N_BUBBLE).copy().reset_index(drop=True)

# Layout grille : N_COLS colonnes, autant de lignes que nécessaire
N_COLS  = 5
n_b     = len(df_top)
cols    = df_top.index % N_COLS
rows    = df_top.index // N_COLS
# Espacement basé sur la taille max pour éviter les chevauchements
spacing = np.sqrt(df_top["n_events"].max()) * 1.6
df_top["gx"] = cols * spacing
df_top["gy"] = -rows * spacing   # lignes vers le bas

# Palette : une couleur distincte par cluster (pas par catégorie inutile)
palette = (
    px.colors.qualitative.Pastel
    + px.colors.qualitative.Safe
    + px.colors.qualitative.Set3
)
colors = [palette[i % len(palette)] for i in range(n_b)]

# Taille des marqueurs Plotly : en pixels (sizemode="diameter")
# On mappe n_events → [30, 110] px de diamètre
s_min, s_max = df_top["n_events"].min(), df_top["n_events"].max()
marker_sizes = 30 + 80 * (df_top["n_events"] - s_min) / max(s_max - s_min, 1)

# Label dans la bulle : mots-clés si cluster assez grand
bubble_text = df_top["label"].where(df_top["n_events"] >= LABEL_MIN, "")

fig_bubble = go.Figure()

fig_bubble.add_trace(go.Scatter(
    x=df_top["gx"],
    y=df_top["gy"],
    mode="markers+text",
    text=bubble_text,
    textposition="middle center",
    textfont=dict(size=9, color="#222"),
    marker=dict(
        size=marker_sizes,
        sizemode="diameter",
        color=colors,
        opacity=0.88,
        line=dict(width=2, color="white"),
    ),
    customdata=list(zip(df_top["label"], df_top["n_events"], df_top["exemple"])),
    hovertemplate=(
        "<b>%{customdata[0]}</b><br>"
        "Events : <b>%{customdata[1]}</b><br>"
        "<i>%{customdata[2]}</i>"
        "<extra></extra>"
    ),
    showlegend=False,
))

fig_bubble.update_layout(
    title=dict(
        text=(
            f"<b>Top {TOP_N_BUBBLE} clusters les plus peuplés</b><br>"
            f"<sup>Taille de la bulle = nombre d'events · "
            f"Hover pour voir le thème et un exemple d'article</sup>"
        ),
        x=0.5, xanchor="center",
        font=dict(size=16),
    ),
    xaxis=dict(visible=False),
    yaxis=dict(visible=False),
    plot_bgcolor="white",
    paper_bgcolor="white",
    width=1400,
    height=680,
    margin=dict(t=90, l=20, r=20, b=20),
    font=dict(family="Arial", size=13),
)


# ── Export HTML unique ────────────────────────────────────────────────────────
print(f"Export -> {OUTPUT_HTML.name}")

# On assemble les deux figures dans un seul HTML
html_tree   = fig_tree.to_html(full_html=False, include_plotlyjs=True)
html_bubble = fig_bubble.to_html(full_html=False, include_plotlyjs=False)

stats_banner = f"""
<div style="
    font-family: Arial, sans-serif;
    background: #f0f4f8;
    border-left: 4px solid #2a7ae2;
    padding: 16px 24px;
    margin: 20px 0 10px 0;
    border-radius: 4px;
    display: flex; gap: 48px; flex-wrap: wrap;
">
  <div><span style="font-size:28px;font-weight:bold;color:#2a7ae2">{n_total:,}</span><br><small style="color:#555">events analysés</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#27ae60">{n_clusters}</span><br><small style="color:#555">clusters thématiques</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#e67e22">{n_noise}</span><br><small style="color:#555">events isolés (hors cluster)</small></div>
  <div><span style="font-size:28px;font-weight:bold;color:#8e44ad">{n_quasi:,}</span><br><small style="color:#555">quasi-doublons détectés</small></div>
</div>
"""

full_html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Dashboard Clustering — Marathon du Web</title>
  <style>
    body {{ font-family: Arial, sans-serif; background: #fff; margin: 30px 40px; }}
    h1   {{ color: #1a1a2e; font-size: 22px; margin-bottom: 4px; }}
    p.sub {{ color: #666; font-size: 14px; margin-top: 0; margin-bottom: 20px; }}
    .section {{ margin-bottom: 40px; }}
    .section h2 {{ font-size: 16px; color: #444; border-bottom: 2px solid #e0e0e0;
                   padding-bottom: 6px; margin-bottom: 12px; }}
  </style>
</head>
<body>
  <h1>Axe 2 — Clustering sémantique des events</h1>
  <p class="sub">
    Embeddings MiniLM → UMAP 50D → HDBSCAN · Score Sij = 0.6×cosine + 0.4×sim_structure
  </p>

  {stats_banner}

  <div class="section">
    <h2>Vue d'ensemble — Tous les clusters (cliquer pour zoomer dans une catégorie)</h2>
    {html_tree}
  </div>

  <div class="section">
    <h2>Top {TOP_N_BUBBLE} clusters les plus peuplés</h2>
    {html_bubble}
  </div>

</body>
</html>"""

with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(full_html)

print(f"\nDashboard -> {OUTPUT_HTML}")
print("Terminé.")
