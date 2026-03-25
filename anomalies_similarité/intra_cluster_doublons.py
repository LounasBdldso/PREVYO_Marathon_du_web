"""
intra_cluster_doublons.py — Détection de doublons à l'intérieur de chaque cluster

Pour chaque cluster (issu de articles_clustering.csv), calcule la similarité
cosinus entre toutes les paires d'articles. Les paires dépassant le seuil sont
exportées dans doublons_articles.csv avec les contextes pour l'affichage.

Usage : python intra_cluster_doublons.py
Output : doublons_articles.csv
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────────
BASE        = Path("/Users/mekkiryan/Desktop/marathon_web")
INPUT_FILE  = BASE / "export.events.json"
EMBED_CACHE = BASE / "embeddings.npy"
CLUSTER_CSV = BASE / "articles_clustering.csv"
OUTPUT_CSV  = BASE / "doublons_articles.csv"

THRESHOLD     = 0.50   # seuil de similarité cosinus
CONTEXT_LEN   = 400    # nb de caractères du contexte affiché

# ── Chargement ─────────────────────────────────────────────────────────────────
print("Chargement des events et embeddings...")
with open(INPUT_FILE, encoding="utf-8") as f:
    events = json.load(f)

emb = np.load(str(EMBED_CACHE)).astype("float32")
assert emb.shape[0] == len(events), "Taille embeddings ≠ nb events"

df_cl = pd.read_csv(CLUSTER_CSV)
print(f"  {len(events)} events · {len(df_cl)} articles dans le CSV")


# ── Reconstruction des embeddings articles ────────────────────────────────────
print("Reconstruction des embeddings par article (resultAnalyseId)...")

def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

groups = defaultdict(list)
for i, e in enumerate(events):
    aid = e.get("resultAnalyseId") or get_id(e)
    groups[aid].append(i)

articles_data = {}
for aid, idxs in groups.items():
    evts = [events[i] for i in idxs]
    art_emb = emb[idxs].mean(axis=0)
    art_emb /= np.linalg.norm(art_emb) + 1e-8

    # Contexte complet : concaténation de tous les contextes non-vides
    contexts = [e.get("context", "").strip() for e in evts if e.get("context", "").strip()]
    full_ctx  = " […] ".join(dict.fromkeys(contexts))   # dédupliqué, ordre préservé
    articles_data[aid] = {"emb": art_emb, "context": full_ctx}

print(f"  {len(articles_data)} articles reconstruits")


# ── Calcul des paires intra-cluster ───────────────────────────────────────────
print(f"Calcul des similarités intra-cluster (seuil = {THRESHOLD})...")

rows = []
df_noisy = df_cl[df_cl["cluster_id"] != -1]

for cluster_id, group in df_noisy.groupby("cluster_id"):
    cluster_label = group["cluster_label"].iloc[0]
    art_ids = [a for a in group["article_id"].tolist() if a in articles_data]

    if len(art_ids) < 2:
        continue

    # Matrice d'embeddings du cluster (déjà L2-normalisés)
    E = np.array([articles_data[a]["emb"] for a in art_ids], dtype="float32")
    sim = E @ E.T   # similarité cosinus (car vecteurs normalisés)

    for i in range(len(art_ids)):
        for j in range(i + 1, len(art_ids)):
            s = float(sim[i, j])
            if s >= THRESHOLD:
                rows.append({
                    "cluster_id"    : int(cluster_id),
                    "cluster_label" : cluster_label,
                    "article_id_1"  : art_ids[i],
                    "article_id_2"  : art_ids[j],
                    "cosine"        : round(s, 4),
                    "context_1"     : articles_data[art_ids[i]]["context"][:CONTEXT_LEN],
                    "context_2"     : articles_data[art_ids[j]]["context"][:CONTEXT_LEN],
                })

df_out = pd.DataFrame(rows).sort_values("cosine", ascending=False).reset_index(drop=True)
df_out.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")
print(f"\n{len(df_out)} paires intra-cluster détectées (cosine >= {THRESHOLD})")
print(f"CSV -> {OUTPUT_CSV.name}")

# ── Stats ──────────────────────────────────────────────────────────────────────
if len(df_out):
    print("\nTop 10 clusters avec le plus de doublons :")
    top = (df_out.groupby(["cluster_id", "cluster_label"])
                 .size().reset_index(name="n_paires")
                 .sort_values("n_paires", ascending=False)
                 .head(10))
    for _, r in top.iterrows():
        print(f"  [{r['n_paires']:4d} paires]  {r['cluster_label']}")

    print(f"\nDistribution des scores cosinus :")
    print(df_out["cosine"].describe().round(4).to_string())
