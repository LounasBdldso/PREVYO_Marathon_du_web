"""
Deduplication d'events par similarite semantique + date.

Pipeline :
  1. Embeddings du champ `context` (MiniLM, mis en cache)
  2. Similarite cosinus par batchs numpy
  3. Filtre date +/- DATE_WINDOW jours
  4. Union-Find -> groupes de doublons
  5. Export JSON annote + rapport CSV
"""

import json
import csv
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from sentence_transformers import SentenceTransformer

# ── Config ────────────────────────────────────────────────────────────────────
BASE          = Path("/Users/mekkiryan/marathon_web")
INPUT_FILE    = BASE / "export.events.json"
OUTPUT_FILE   = BASE / "events_deduplicated.json"
REPORT_FILE   = BASE / "merge_report.csv"
EMBED_CACHE   = BASE / "embeddings.npy"
MODEL_NAME    = "paraphrase-multilingual-MiniLM-L12-v2"
COS_THRESHOLD = 0.9999
DATE_WINDOW   = 1       # jours (None = ignorer la date)
BATCH_SIZE    = 500     # lignes traitees a la fois
# ─────────────────────────────────────────────────────────────────────────────


def get_id(event):
    raw = event.get("_id", {})
    return raw.get("$oid", str(raw)) if isinstance(raw, dict) else str(raw)

def get_context(event):
    return (event.get("context") or "").strip()

def parse_date(event):
    for field in ("createdAt", "endAt"):
        raw = event.get(field)
        if not raw:
            continue
        date_str = raw.get("$date") if isinstance(raw, dict) else raw
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except Exception:
            continue
    return None


class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank   = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, x, y):
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return False
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1
        return True

    def groups(self):
        from collections import defaultdict
        g = defaultdict(list)
        for i in range(len(self.parent)):
            g[self.find(i)].append(i)
        return dict(g)


def main():
    # 1. Charger
    print(f"Chargement de {INPUT_FILE}...")
    with open(INPUT_FILE, encoding="utf-8") as f:
        events = json.load(f)
    n = len(events)
    print(f"{n} events charges.")

    contexts = [get_context(e) for e in events]
    dates    = [parse_date(e) for e in events]
    ids      = [get_id(e) for e in events]

    empty = sum(1 for c in contexts if not c)
    if empty:
        print(f"  {empty} events sans context.")

    # 2. Embeddings (avec cache)
    if EMBED_CACHE.exists():
        print(f"Cache trouve -> chargement embeddings...")
        emb = np.load(str(EMBED_CACHE)).astype("float32")
        assert emb.shape[0] == n, "Cache obsolete, supprime embeddings.npy"
    else:
        print(f"Calcul des embeddings ({MODEL_NAME})...")
        model = SentenceTransformer(MODEL_NAME)
        emb = model.encode(
            contexts,
            show_progress_bar=True,
            normalize_embeddings=True,
            batch_size=64,
        ).astype("float32")
        np.save(str(EMBED_CACHE), emb)
        print(f"Embeddings sauvegardes dans {EMBED_CACHE.name}")

    # 3. Similarite par batchs + Union-Find
    print(f"Calcul des similarites (batchs de {BATCH_SIZE})...")
    uf     = UnionFind(n)
    merges = []

    for start in range(0, n, BATCH_SIZE):
        end   = min(start + BATCH_SIZE, n)
        block = emb[start:end]
        sim   = block @ emb.T                    # cosinus = dot product (vecteurs normalises)

        for local_i, global_i in enumerate(range(start, end)):
            if not contexts[global_i]:
                continue
            row = sim[local_i]
            candidates = np.where(row >= COS_THRESHOLD)[0]
            for j in candidates:
                j = int(j)
                if j <= global_i:
                    continue
                if not contexts[j]:
                    continue
                d_i, d_j = dates[global_i], dates[j]
                if d_i and d_j and DATE_WINDOW:
                    if abs((d_i - d_j).total_seconds()) > DATE_WINDOW * 86400:
                        continue
                if uf.union(global_i, j):
                    merges.append((ids[global_i], ids[j], round(float(row[j]), 4)))

        pct = round(end / n * 100)
        print(f"  {end}/{n} ({pct}%)", end="\r")

    print()

    # 4. Stats
    groups     = uf.groups()
    dup_groups = {r: g for r, g in groups.items() if len(g) > 1}
    nb_dupes   = sum(len(g) - 1 for g in dup_groups.values())
    print(f"\n{nb_dupes} doublons dans {len(dup_groups)} groupes.")

    # 5. Annoter les events
    canonical_map = {}
    for root, group in groups.items():
        canon = ids[root]
        for idx in group:
            canonical_map[idx] = canon

    for i, event in enumerate(events):
        event["canonical_id"] = canonical_map[i]
        event["is_duplicate"] = (canonical_map[i] != ids[i])

    # 6. Sauvegarder
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2, default=str)
    print(f"JSON sauvegarde -> {OUTPUT_FILE.name}")

    with open(REPORT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["event_id_1", "event_id_2", "cosine_score"])
        writer.writerows(merges)
    print(f"Rapport CSV -> {REPORT_FILE.name}")
    print(f"\nTermine. {n - nb_dupes} events uniques sur {n}.")


if __name__ == "__main__":
    main()
