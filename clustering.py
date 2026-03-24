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
BASE         = Path("/Users/mekkiryan/marathon_web")
INPUT_FILE   = BASE / "export.events.json"
EMBED_CACHE  = BASE / "embeddings.npy"
OUTPUT_CSV   = BASE / "clustering.csv"
OUTPUT_JSON  = BASE / "events_clustering.json"
OUTPUT_HTML  = BASE / "umap_clusters.html"
QUASI_CSV    = BASE / "quasi_doublons.csv"

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

    # ── 3. UMAP 2D -> Plotly ──────────────────────────────────────────────────
    print("\nUMAP 2D depuis 50D...")
    reducer_2d = umap.UMAP(n_components=2, random_state=42, n_jobs=1,
                            n_neighbors=15, min_dist=0.1)
    emb_2d = reducer_2d.fit_transform(emb_50d)

    print("Export HTML Plotly...")
    cluster_names = [cluster_keywords.get(int(l), f"cluster_{l}") for l in labels]

    df_plot = pd.DataFrame({
        "x"       : emb_2d[:, 0],
        "y"       : emb_2d[:, 1],
        "cluster" : [str(int(l)) for l in labels],
        "label"   : cluster_names,
        "type"    : [get_type(e) for e in events],
        "context" : [c[:120] for c in contexts],
        "id"      : ids,
    })

    fig = px.scatter(
        df_plot, x="x", y="y",
        color="cluster",
        hover_data={
            "label": True, "type": True, "context": True, "id": True,
            "x": False, "y": False,
        },
        title=f"UMAP 2D — {n_clusters} clusters HDBSCAN ({n} events)",
        width=1400, height=900,
    )
    fig.update_traces(marker=dict(size=4, opacity=0.65))
    fig.write_html(str(OUTPUT_HTML))
    print(f"HTML -> {OUTPUT_HTML.name}")

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
            "x_umap2d"      : round(float(emb_2d[i, 0]), 4),
            "y_umap2d"      : round(float(emb_2d[i, 1]), 4),
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
