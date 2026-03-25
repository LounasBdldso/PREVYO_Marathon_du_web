"""
Axe 2 - Similarite et clustering des events

Pipeline :
  1. Quasi-doublons  : Sij > 0.90 où Sij = 0.6*cosine + 0.4*sim_structure
     sim_structure = 0.50*tax_communs + 0.30*labels_communs + 0.20*edge_types_communs
  2. UMAP (50D) sur embeddings -> HDBSCAN (min_cluster_size=5) -> labels TF-IDF (3 mots)
  3. UMAP (2D) depuis 50D -> export HTML Plotly interactif
  4. Export CSV + JSON annote
"""

import json
import csv
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict
from sklearn.feature_extraction.text import TfidfVectorizer
import umap
import hdbscan as hdbscan_lib
import plotly.express as px

FRENCH_STOPWORDS = {
    "le","la","les","de","du","des","un","une","en","et","est","il","elle",
    "ils","elles","nous","vous","on","se","sa","son","ses","leur","leurs",
    "que","qui","ne","pas","par","sur","dans","au","aux","ce","cet","cette",
    "ces","ou","où","mais","donc","car","ni","or","si","à","y","en","très",
    "plus","bien","tout","tous","aussi","après","avant","lors","depuis","été",
    "être","avoir","fait","avec","pour","sans","sous","entre","vers","chez",
    "lors","dont","même","comme","selon","après","déjà","plus","lors",
}

# ── Config ────────────────────────────────────────────────────────────────────
BASE          = Path("/Users/mekkiryan/Desktop/marathon_web")
INPUT_FILE    = BASE / "export.events.json"
EMBED_CACHE   = BASE / "embeddings.npy"
OUTPUT_CSV    = BASE / "clustering.csv"
OUTPUT_JSON   = BASE / "events_clustering.json"
OUTPUT_HTML   = BASE / "treemap_clusters.html"
OUTPUT_BUBBLE = BASE / "bubble_clusters.html"
QUASI_CSV     = BASE / "quasi_doublons.csv"

QUASI_THRESHOLD = 0.90    # seuil Sij pour quasi-doublon
COS_PREFILTER   = 0.80    # filtre rapide avant calcul sim_structure
BATCH_SIZE      = 500
UMAP_HD         = 50      # dimensions pour HDBSCAN
HDBSCAN_MIN     = 5       # min_cluster_size
N_KEYWORDS      = 3       # mots-clés TF-IDF par cluster
# ─────────────────────────────────────────────────────────────────────────────


def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

def get_type(event):
    return event.get("type", "")

def get_context(event):
    return (event.get("context") or "").strip()


def build_sets(events):
    """Precompute node labels and edge types as frozensets."""
    labels_list = []
    etypes_list = []
    for e in events:
        labels = frozenset(lbl for n in e.get("nodes", []) for lbl in n.get("labels", []))
        etypes = frozenset(ed.get("type", "") for ed in e.get("edges", []))
        labels_list.append(labels)
        etypes_list.append(etypes)
    return labels_list, etypes_list


def sim_structure(i, j, events, labels_list, etypes_list):
    # Taxonomie : niveaux communs / profondeur max
    t1 = get_type(events[i]).split("/")
    t2 = get_type(events[j]).split("/")
    common = sum(a == b for a, b in zip(t1, t2))
    max_d  = max(len(t1), len(t2), 1)
    tax_sim = common / max_d

    # Node labels Jaccard
    l1, l2 = labels_list[i], labels_list[j]
    u_l = l1 | l2
    label_sim = len(l1 & l2) / len(u_l) if u_l else 1.0

    # Edge types Jaccard
    e1, e2 = etypes_list[i], etypes_list[j]
    u_e = e1 | e2
    etype_sim = len(e1 & e2) / len(u_e) if u_e else 1.0

    return 0.50 * tax_sim + 0.30 * label_sim + 0.20 * etype_sim


def tfidf_keywords(texts, n=3):
    if not texts:
        return []
    try:
        vec = TfidfVectorizer(max_features=2000, min_df=1, sublinear_tf=True,
                              stop_words=list(FRENCH_STOPWORDS))
        X   = vec.fit_transform(texts)
        scores = X.mean(axis=0).A1
        top_idx = scores.argsort()[::-1][:n]
        return [vec.get_feature_names_out()[i] for i in top_idx]
    except Exception:
        return []


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Chargement...")
    with open(INPUT_FILE, encoding="utf-8") as f:
        events = json.load(f)
    n = len(events)
    print(f"{n} events charges.")

    ids      = [get_id(e)      for e in events]
    contexts = [get_context(e) for e in events]

    print("Chargement embeddings...")
    emb = np.load(str(EMBED_CACHE)).astype("float32")
    assert emb.shape[0] == n

    print("Precompute labels & edge types...")
    labels_list, etypes_list = build_sets(events)

    # ── 1. Quasi-doublons ─────────────────────────────────────────────────────
    print(f"Recherche quasi-doublons (Sij > {QUASI_THRESHOLD}, prefiltre cos > {COS_PREFILTER})...")
    quasi_pairs = []

    for start in range(0, n, BATCH_SIZE):
        end   = min(start + BATCH_SIZE, n)
        block = emb[start:end]
        cos   = block @ emb.T   # (batch, n) — vecteurs normalises donc cosinus = dot

        for local_i, global_i in enumerate(range(start, end)):
            row        = cos[local_i]
            candidates = np.where(row >= COS_PREFILTER)[0]
            for j in candidates:
                j = int(j)
                if j <= global_i:
                    continue
                c   = float(row[j])
                s   = sim_structure(global_i, j, events, labels_list, etypes_list)
                sij = 0.6 * c + 0.4 * s
                if sij >= QUASI_THRESHOLD:
                    quasi_pairs.append({
                        "id_1"          : ids[global_i],
                        "id_2"          : ids[j],
                        "cosine"        : round(c,   4),
                        "sim_structure" : round(s,   4),
                        "sij"           : round(sij, 4),
                        "type_1"        : get_type(events[global_i]),
                        "type_2"        : get_type(events[j]),
                    })

        pct = round(end / n * 100)
        print(f"  {end}/{n} ({pct}%)", end="\r")

    print()
    print(f"{len(quasi_pairs)} paires quasi-doublons.")

    with open(QUASI_CSV, "w", newline="", encoding="utf-8") as f:
        if quasi_pairs:
            writer = csv.DictWriter(f, fieldnames=quasi_pairs[0].keys())
            writer.writeheader()
            writer.writerows(sorted(quasi_pairs, key=lambda r: r["sij"], reverse=True))
    print(f"Quasi-doublons -> {QUASI_CSV.name}")

    # ── 2. UMAP 50D -> HDBSCAN ────────────────────────────────────────────────
    print(f"\nUMAP {UMAP_HD}D (peut prendre 2-3 min)...")
    reducer_hd = umap.UMAP(n_components=UMAP_HD, random_state=42, n_jobs=1,
                            n_neighbors=15, min_dist=0.0)
    emb_50d = reducer_hd.fit_transform(emb)
    print(f"  emb_50d shape : {emb_50d.shape}")

    print(f"HDBSCAN (min_cluster_size={HDBSCAN_MIN})...")
    clusterer = hdbscan_lib.HDBSCAN(min_cluster_size=HDBSCAN_MIN, core_dist_n_jobs=1)
    labels    = clusterer.fit_predict(emb_50d)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise    = int((labels == -1).sum())
    print(f"  {n_clusters} clusters | {n_noise} events non-clusteres (label=-1)")

    # TF-IDF keywords
    print("Labels TF-IDF...")
    cluster_keywords = {}
    for c in sorted(set(labels)):
        if c == -1:
            cluster_keywords[-1] = "non-clustere"
            continue
        texts = [contexts[i] for i in range(n) if labels[i] == c and contexts[i]]
        kws   = tfidf_keywords(texts, N_KEYWORDS)
        cluster_keywords[c] = " | ".join(kws) if kws else f"cluster_{c}"
        if c < 5 or c % 20 == 0:
            print(f"  Cluster {c:3d} ({len(texts):5d} events) : {cluster_keywords[c]}")

    # ── 3. Treemap Plotly ─────────────────────────────────────────────────────
    print("Export treemap Plotly...")

    # Construire un DataFrame 1 ligne par cluster (hors label=-1)
    cluster_rows = []
    for c in sorted(set(labels)):
        if c == -1:
            continue
        idxs_c = [i for i in range(n) if labels[i] == c]
        # Type dominant niveau 2 (ex: Thing/Abstract → "Abstract")
        def type_l2(e):
            parts = get_type(e).split("/")
            return parts[1] if len(parts) > 1 else (parts[0] or "Inconnu")
        type_l2_list = [type_l2(events[i]) for i in idxs_c]
        dominant = max(set(type_l2_list), key=type_l2_list.count)
        exemple = next((contexts[i] for i in idxs_c if contexts[i]), "")
        cluster_rows.append({
            "cluster_id"  : c,
            "label"       : cluster_keywords.get(c, f"cluster_{c}"),
            "n_events"    : len(idxs_c),
            "type_l2"     : dominant,
            "exemple"     : exemple[:150],
        })

    df_tree = pd.DataFrame(cluster_rows).sort_values("n_events", ascending=False)

    fig = px.treemap(
        df_tree,
        path=[px.Constant("Tous les clusters"), "type_l2", "label"],
        values="n_events",
        color="n_events",
        color_continuous_scale="Blues",
        color_continuous_midpoint=df_tree["n_events"].median(),
        hover_data={"exemple": True, "cluster_id": True},
        title=f"{n_clusters} clusters HDBSCAN — {n} events ({n_noise} non-clusterés)",
        width=1400, height=850,
    )
    fig.update_traces(
        textinfo="label+value",
        hovertemplate="<b>%{label}</b><br>Events: %{value}<br>%{customdata[0]}<extra></extra>",
    )
    fig.write_html(str(OUTPUT_HTML))
    print(f"Treemap -> {OUTPUT_HTML.name}")

    # ── Bubble chart : top 50 clusters ────────────────────────────────────────
    print("Export bubble chart Plotly...")

    TOP_N = 50
    df_top = df_tree.head(TOP_N).copy()

    # Position x : rang dans chaque groupe type_l2 (pour espacer les bulles)
    df_top = df_top.sort_values(["type_l2", "n_events"], ascending=[True, False])
    df_top["x_rank"] = df_top.groupby("type_l2").cumcount()

    # Ordre y : types triés par total events décroissant
    type_totals = df_top.groupby("type_l2")["n_events"].sum().sort_values(ascending=False)
    type_order_bubble = type_totals.index.tolist()

    fig2 = px.scatter(
        df_top,
        x="x_rank",
        y="type_l2",
        size="n_events",
        color="type_l2",
        hover_name="label",
        hover_data={"n_events": True, "exemple": True, "cluster_id": True,
                    "x_rank": False, "type_l2": False},
        size_max=70,
        category_orders={"type_l2": type_order_bubble},
        title=f"Top {TOP_N} clusters — taille = nombre d'events",
        labels={"x_rank": "", "type_l2": "Catégorie", "n_events": "Events"},
        width=1300, height=700,
    )
    fig2.update_traces(marker=dict(opacity=0.80, line=dict(width=1, color="white")))
    fig2.update_xaxes(showticklabels=False, showgrid=False, zeroline=False)
    fig2.update_yaxes(showgrid=True, gridcolor="#e8e8e8")
    fig2.update_layout(
        plot_bgcolor="white",
        showlegend=False,
        font=dict(size=13),
    )
    fig2.write_html(str(OUTPUT_BUBBLE))
    print(f"Bubble chart -> {OUTPUT_BUBBLE.name}")

    # ── 4. Export CSV + JSON ──────────────────────────────────────────────────
    quasi_set = set(p["id_1"] for p in quasi_pairs) | set(p["id_2"] for p in quasi_pairs)

    rows = []
    for i, e in enumerate(events):
        label_i = int(labels[i])
        kw_i    = cluster_keywords.get(label_i, f"cluster_{label_i}")
        rows.append({
            "event_id"      : ids[i],
            "type"          : get_type(e),
            "cluster_id"    : label_i,
            "cluster_label" : kw_i,
            "is_noise"      : label_i == -1,
            "is_quasi_dup"  : ids[i] in quasi_set,
        })
        e["cluster_id"]    = label_i
        e["cluster_label"] = kw_i
        e["is_noise"]      = label_i == -1
        e["is_quasi_dup"]  = ids[i] in quasi_set

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV -> {OUTPUT_CSV.name}")

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2, default=str)
    print(f"JSON -> {OUTPUT_JSON.name}")

    # Stats finales
    from collections import Counter
    tier = Counter(int(l) for l in labels)
    top5 = tier.most_common(5)
    print("\nTop 5 clusters (taille) :")
    for c, sz in top5:
        print(f"  Cluster {c:4d} ({sz:5d} events) : {cluster_keywords.get(c, '')}")

    print("\nTermine.")


if __name__ == "__main__":
    main()
