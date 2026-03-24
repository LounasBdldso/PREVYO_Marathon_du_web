"""
Axe 1 - Detection d'anomalies

Pipeline :
  1. Construction des features (embeddings + structure + taxonomie)
  2. Isolation Forest  -> score global [0,1]
  3. DBSCAN par type   -> label -1 si hors cluster
  4. Score compose     -> 0.6 * IF + 0.4 * DBSCAN_outlier
  5. Niveau d'alerte   -> Critique / Suspect / Normal
  6. Explication en langage naturel
  7. Export CSV
"""

import json
import csv
import numpy as np
import pandas as pd
from pathlib import Path
from collections import Counter
from sklearn.ensemble import IsolationForest
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

# ── Config ────────────────────────────────────────────────────────────────────
BASE         = Path("/Users/mekkiryan/marathon_web")
INPUT_FILE   = BASE / "export.events.json"
EMBED_CACHE  = BASE / "embeddings.npy"
OUTPUT_CSV   = BASE / "anomalies.csv"
OUTPUT_JSON  = BASE / "events_anomalies.json"

IF_CONTAMINATION = 0.05   # ~5% d'anomalies attendues
DBSCAN_EPS       = 1.2    # rayon DBSCAN dans l'espace PCA reduit
DBSCAN_MIN       = 5      # min samples par cluster
DBSCAN_TAX_DEPTH = 3      # niveaux taxonomiques pour grouper (ex: Thing/Abstract/Event)
# ─────────────────────────────────────────────────────────────────────────────


def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

def get_type(event):
    return event.get("type", "")

def taxonomy_depth(type_str):
    return len(type_str.split("/")) if type_str else 0

def structural_features(event):
    nodes     = event.get("nodes", [])
    edges     = event.get("edges", [])
    edge_types = set(e.get("type", "") for e in edges)
    node_labels = set(
        lbl for n in nodes for lbl in n.get("labels", [])
    )
    return {
        "nb_nodes"      : len(nodes),
        "nb_edges"      : len(edges),
        "nb_edge_types" : len(edge_types),
        "nb_node_labels": len(node_labels),
        "tax_depth"     : taxonomy_depth(get_type(event)),
    }

def build_type_onehot(events):
    """One-hot sur les 3 premiers niveaux de la taxonomie."""
    level_sets = [set(), set(), set()]
    for e in events:
        parts = get_type(e).split("/")
        for i in range(3):
            if i < len(parts):
                level_sets[i].add(parts[i])
    vocabs = [sorted(s) for s in level_sets]
    idx    = [{v: j for j, v in enumerate(vocab)} for vocab in vocabs]

    def encode(event):
        parts = get_type(event).split("/")
        vec = []
        for i, vocab in enumerate(vocabs):
            oh = [0] * len(vocab)
            if i < len(parts) and parts[i] in idx[i]:
                oh[idx[i][parts[i]]] = 1
            vec.extend(oh)
        return vec

    return encode, sum(len(v) for v in vocabs)

def explain(event, score, is_dbscan_outlier, struct, type_counts):
    reasons = []
    t = get_type(event)
    count = type_counts.get(t, 0)
    total = sum(type_counts.values())

    if count <= 5:
        reasons.append(f"Type tres rare : {count} occurrence(s) sur {total}.")
    if struct["nb_nodes"] == 0:
        reasons.append("Aucun noeud.")
    elif struct["nb_nodes"] > np.percentile(list(v["nb_nodes"] for v in all_structs), 95):
        reasons.append(f"Nombre de noeuds inhabituel : {struct['nb_nodes']}.")
    if struct["nb_edges"] == 0 and struct["nb_nodes"] > 1:
        reasons.append("Aucune arete malgre plusieurs noeuds.")
    if is_dbscan_outlier:
        reasons.append(f"Contexte semantiquement isole parmi les events de type '{t}'.")
    if not reasons:
        reasons.append("Combinaison inhabituelle de features (Isolation Forest).")
    return " | ".join(reasons)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global all_structs

    # 1. Charger
    print("Chargement...")
    with open(INPUT_FILE, encoding="utf-8") as f:
        events = json.load(f)
    n = len(events)
    print(f"{n} events charges.")

    ids   = [get_id(e) for e in events]
    types = [get_type(e) for e in events]
    type_counts = Counter(types)

    # 2. Embeddings (cache)
    print("Chargement embeddings...")
    emb = np.load(str(EMBED_CACHE)).astype("float32")
    assert emb.shape[0] == n

    # 3. Features structurelles
    print("Calcul des features structurelles...")
    all_structs = [structural_features(e) for e in events]
    struct_keys = ["nb_nodes", "nb_edges", "nb_edge_types", "nb_node_labels", "tax_depth"]
    struct_matrix = np.array([[s[k] for k in struct_keys] for s in all_structs], dtype="float32")

    # 4. One-hot taxonomique
    print("Encodage taxonomique...")
    encode_type, onehot_dim = build_type_onehot(events)
    onehot_matrix = np.array([encode_type(e) for e in events], dtype="float32")

    # 5. Matrice de features finale
    X = np.hstack([emb, struct_matrix, onehot_matrix])
    print(f"Matrice features : {X.shape}")

    # Normalisation
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 6. Isolation Forest
    print("Isolation Forest...")
    iso = IsolationForest(contamination=IF_CONTAMINATION, random_state=42, n_jobs=-1)
    iso.fit(X_scaled)
    # score_samples -> plus negatif = plus anormal ; on inverse et normalise [0,1]
    raw_scores = iso.score_samples(X_scaled)
    # Normalisation min-max -> score_IF : 1 = tres anormal
    score_if = 1 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min())

    # 7. Score local k-NN par groupe taxonomique
    # Pour chaque event : similarite cosinus moyenne avec ses K voisins dans le meme groupe
    # Faible similarite = event semantiquement isole dans son groupe = anomalie locale
    KNN_K = 10
    print(f"Score local k-NN (k={KNN_K}) par groupe taxonomique...")

    tax_groups = {}
    for i, t in enumerate(types):
        prefix = "/".join(t.split("/")[:DBSCAN_TAX_DEPTH]) if t else "unknown"
        tax_groups.setdefault(prefix, []).append(i)

    knn_scores = np.zeros(n, dtype="float32")  # 0 = tres isole, 1 = tres proche de ses voisins

    for prefix, idxs in tax_groups.items():
        idxs = np.array(idxs)
        sub  = emb[idxs]  # vecteurs normalises -> cosinus = dot product
        k    = min(KNN_K + 1, len(idxs))
        sim  = sub @ sub.T  # (m, m)
        np.fill_diagonal(sim, -1)  # exclure soi-meme
        top_k_sim = np.sort(sim, axis=1)[:, -k+1:]  # k-1 meilleurs voisins
        avg_sim = top_k_sim.mean(axis=1)
        for local_i, global_i in enumerate(idxs):
            knn_scores[global_i] = float(avg_sim[local_i])

    # Normaliser : score_local = 1 - sim_normalisee (1 = tres anormal)
    mn, mx = knn_scores.min(), knn_scores.max()
    score_local = 1 - (knn_scores - mn) / (mx - mn + 1e-8)
    print(f"  Score local moyen : {score_local.mean():.3f} | std : {score_local.std():.3f}")

    # 8. Score compose
    score_final = 0.6 * score_if + 0.4 * score_local

    # 9. Niveaux d'alerte
    def niveau(s):
        if s > 0.80:   return "Critique"
        if s > 0.55:   return "Suspect"
        return "Normal"

    niveaux = [niveau(s) for s in score_final]

    # 10. Explications
    print("Generation des explications...")
    is_local_outlier = score_local > 0.7   # events semantiquement isoles dans leur groupe
    explications = [
        explain(events[i], score_final[i], bool(is_local_outlier[i]), all_structs[i], type_counts)
        for i in range(n)
    ]

    # 11. Stats
    counts = Counter(niveaux)
    print(f"\nCritique : {counts['Critique']} | Suspect : {counts['Suspect']} | Normal : {counts['Normal']}")

    # 12. Export CSV (trie par score desc)
    print(f"Export CSV -> {OUTPUT_CSV.name}")
    rows = sorted(
        [
            {
                "event_id"    : ids[i],
                "type"        : types[i],
                "score_if"    : round(float(score_if[i]), 4),
                "score_local" : round(float(score_local[i]), 4),
                "score_final" : round(float(score_final[i]), 4),
                "niveau"      : niveaux[i],
                "explication" : explications[i],
                "context"     : (events[i].get("context") or "")[:200],
            }
            for i in range(n)
        ],
        key=lambda r: r["score_final"],
        reverse=True,
    )
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    # 13. Annoter les events JSON
    score_by_id = {ids[i]: {"anomaly_score": round(float(score_final[i]), 4), "anomaly_niveau": niveaux[i], "anomaly_explication": explications[i]} for i in range(n)}
    for e in events:
        info = score_by_id.get(get_id(e), {})
        e.update(info)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2, default=str)
    print(f"JSON annote -> {OUTPUT_JSON.name}")
    print("\nTermine.")


if __name__ == "__main__":
    main()
