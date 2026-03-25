"""
app.py — Application Streamlit · Marathon du Web · EMVISTA / PREVYO

4 vues :
    1. Tableau de bord  — KPIs globaux
    2. Anomalies        — liste filtrable, scores, explications
    3. Similarité       — clusters d'articles (treemap + bubble chart)
    4. Exploration      — recherche plein texte + détail JSON d'un event

Lancement :
    streamlit run app.py
"""

import json
import numpy as np
import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from pathlib import Path
from collections import Counter

# ── Config ────────────────────────────────────────────────────────────────────
BASE = Path("/Users/mekkiryan/Desktop/marathon_web")

st.set_page_config(
    page_title="PREVYO — Marathon du Web",
    page_icon="🔍",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Chargement des données (mis en cache) ─────────────────────────────────────
@st.cache_data
def load_anomalies():
    return pd.read_csv(BASE / "anomalies.csv")

@st.cache_data
def load_clustering():
    return pd.read_csv(BASE / "articles_clustering.csv")

@st.cache_data
def load_quasi():
    return pd.read_csv(BASE / "quasi_doublons.csv")

@st.cache_data
def load_doublons_articles():
    p = BASE / "doublons_articles.csv"
    if p.exists():
        return pd.read_csv(p)
    return pd.DataFrame()

@st.cache_data
def load_events():
    with open(BASE / "events_anomalies.json", encoding="utf-8") as f:
        return json.load(f)

@st.cache_data
def load_cluster_events():
    with open(BASE / "events_clustering.json", encoding="utf-8") as f:
        return json.load(f)

# ── Sidebar — navigation ──────────────────────────────────────────────────────
with st.sidebar:
    st.image("https://img.icons8.com/fluency/96/graph.png", width=60)
    st.markdown("## PREVYO")
    st.markdown("*Marathon du Web 2026*")
    st.divider()
    vue = st.radio(
        "Navigation",
        ["Tableau de bord", "Anomalies", "Similarité", "Exploration"],
        label_visibility="collapsed",
    )
    st.divider()
    st.caption("Équipe MIASHS · EMVISTA")


# ══════════════════════════════════════════════════════════════════════════════
# VUE 1 — TABLEAU DE BORD
# ══════════════════════════════════════════════════════════════════════════════
if vue == "Tableau de bord":
    st.title("Tableau de bord")
    st.caption("Vue globale sur la base de connaissances PREVYO")

    df_a  = load_anomalies()
    df_cl = load_clustering()
    df_q  = load_quasi()

    n_events   = len(df_a)
    n_critique = (df_a["niveau"] == "Critique").sum()
    n_suspect  = (df_a["niveau"] == "Suspect").sum()
    n_normal   = (df_a["niveau"] == "Normal").sum()
    n_clusters = df_cl["cluster_id"].nunique() - (1 if -1 in df_cl["cluster_id"].values else 0)
    n_noise    = (df_cl["is_noise"] == True).sum()
    n_quasi    = len(df_q)

    # KPIs
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Events analysés",      f"{n_events:,}")
    c2.metric("🔴 Critiques",          f"{n_critique:,}")
    c3.metric("🟠 Suspects",           f"{n_suspect:,}")
    c4.metric("Clusters thématiques", f"{n_clusters:,}")
    c5.metric("Articles isolés",       f"{n_noise:,}")
    c6.metric("Quasi-doublons",        f"{n_quasi:,}")

    st.divider()
    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("Répartition des niveaux d'anomalie")
        fig_pie = px.pie(
            values=[n_critique, n_suspect, n_normal],
            names=["Critique", "Suspect", "Normal"],
            color=["Critique", "Suspect", "Normal"],
            color_discrete_map={
                "Critique": "#e74c3c",
                "Suspect":  "#e67e22",
                "Normal":   "#2ecc71",
            },
            hole=0.45,
        )
        fig_pie.update_traces(textinfo="percent+label", textfont_size=13)
        fig_pie.update_layout(showlegend=False, margin=dict(t=10, b=10))
        st.plotly_chart(fig_pie, use_container_width=True)

    with col_right:
        st.subheader("Top 15 types d'events les plus fréquents")
        type_counts = df_a["type"].value_counts().head(15).reset_index()
        type_counts.columns = ["type", "count"]
        fig_bar = px.bar(
            type_counts.sort_values("count"),
            x="count", y="type", orientation="h",
            color="count", color_continuous_scale="Blues",
            labels={"count": "Nombre d'events", "type": ""},
        )
        fig_bar.update_layout(
            coloraxis_showscale=False,
            margin=dict(t=10, b=10),
            yaxis=dict(tickfont=dict(size=11)),
        )
        st.plotly_chart(fig_bar, use_container_width=True)

    st.divider()
    st.subheader("Distribution des scores d'anomalie")
    fig_hist = px.histogram(
        df_a, x="score_final", nbins=60,
        color="niveau",
        color_discrete_map={
            "Critique": "#e74c3c",
            "Suspect":  "#e67e22",
            "Normal":   "#2ecc71",
        },
        labels={"score_final": "Score d'anomalie", "count": "Nombre d'events"},
        barmode="overlay", opacity=0.75,
    )
    fig_hist.add_vline(x=0.80, line_dash="dash", line_color="#e74c3c",
                        annotation_text="Seuil Critique (0.80)")
    fig_hist.add_vline(x=0.55, line_dash="dash", line_color="#e67e22",
                        annotation_text="Seuil Suspect (0.55)")
    fig_hist.update_layout(margin=dict(t=10, b=10))
    st.plotly_chart(fig_hist, use_container_width=True)


# ══════════════════════════════════════════════════════════════════════════════
# VUE 2 — ANOMALIES
# ══════════════════════════════════════════════════════════════════════════════
elif vue == "Anomalies":
    st.title("Anomalies détectées")
    st.caption(
        "Score = 0.6 × Isolation Forest + 0.4 × isolation sémantique locale (k-NN)"
    )

    df_a = load_anomalies()

    # Filtres
    col1, col2, col3 = st.columns([2, 2, 3])
    with col1:
        niveaux = st.multiselect(
            "Niveau d'alerte",
            ["Critique", "Suspect", "Normal"],
            default=["Critique", "Suspect"],
        )
    with col2:
        score_min = st.slider("Score minimum", 0.0, 1.0, 0.55, 0.01)
    with col3:
        search = st.text_input("Filtrer par type ou explication", "")

    df_f = df_a[df_a["niveau"].isin(niveaux) & (df_a["score_final"] >= score_min)]
    if search:
        mask = (
            df_f["type"].str.contains(search, case=False, na=False)
            | df_f["explication"].str.contains(search, case=False, na=False)
        )
        df_f = df_f[mask]

    st.markdown(f"**{len(df_f):,} events** correspondent aux filtres.")

    # Tableau
    def color_niveau(val):
        colors = {"Critique": "#ffd5d5", "Suspect": "#fff0d5", "Normal": "#d5f5e3"}
        return f"background-color: {colors.get(val, 'white')}"

    display_cols = ["event_id", "type", "score_final", "score_if",
                    "score_local", "niveau", "explication", "context"]
    df_display = df_f[display_cols].head(500)

    st.dataframe(
        df_display.style.applymap(color_niveau, subset=["niveau"]),
        use_container_width=True,
        height=450,
        column_config={
            "score_final": st.column_config.ProgressColumn(
                "Score final", min_value=0, max_value=1, format="%.3f"
            ),
            "score_if": st.column_config.NumberColumn("IF", format="%.3f"),
            "score_local": st.column_config.NumberColumn("Local", format="%.3f"),
            "context": st.column_config.TextColumn("Contexte", width="large"),
        },
    )

    st.divider()

    # Détail d'un event
    st.subheader("Détail d'un event")
    event_ids = df_f["event_id"].tolist()
    if event_ids:
        selected = st.selectbox("Choisir un event", event_ids[:200])
        row = df_f[df_f["event_id"] == selected].iloc[0]
        c1, c2, c3 = st.columns(3)
        c1.metric("Score final", f"{row['score_final']:.3f}")
        c2.metric("Niveau", row["niveau"])
        c3.metric("Type", row["type"])
        st.info(f"**Explication :** {row['explication']}")
        if pd.notna(row.get("context")):
            st.markdown("**Contexte :**")
            st.write(str(row["context"]))


# ══════════════════════════════════════════════════════════════════════════════
# VUE 3 — SIMILARITÉ
# ══════════════════════════════════════════════════════════════════════════════
elif vue == "Similarité":
    st.title("Similarité et clustering")
    st.caption(
        "Articles regroupés par similarité sémantique · "
        "UMAP 50D → HDBSCAN · Labels TF-IDF"
    )

    df_cl = load_clustering()
    df_q  = load_quasi()

    # KPIs
    n_clusters = df_cl["cluster_id"].nunique() - (1 if -1 in df_cl["cluster_id"].values else 0)
    n_noise    = df_cl["is_noise"].sum()
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Articles analysés", f"{len(df_cl):,}")
    c2.metric("Clusters", f"{n_clusters:,}")
    c3.metric("Articles isolés", f"{int(n_noise):,}")
    c4.metric("Quasi-doublons (Sij > 0.90)", f"{len(df_q):,}")

    st.divider()
    tab1, tab2, tab3, tab4 = st.tabs(["Treemap", "Bubble chart", "Quasi-doublons", "Doublons intra-cluster"])

    # ── Treemap ──
    with tab1:
        st.markdown("Chaque rectangle = 1 cluster · Taille ∝ nombre d'articles · Cliquer pour zoomer")

        cluster_summary = (
            df_cl[df_cl["cluster_id"] != -1]
            .groupby(["cluster_id", "cluster_label"])
            .agg(n_articles=("cluster_id", "count"), dominant_type=("dominant_type", lambda x: x.mode()[0]))
            .reset_index()
            .sort_values("n_articles", ascending=False)
        )

        def type_l3(t):
            parts = [p for p in str(t).split("/") if p]
            if len(parts) >= 3: return parts[2]
            if len(parts) == 2: return parts[1]
            return parts[0] if parts else "Inconnu"

        cluster_summary["type_cat"] = cluster_summary["dominant_type"].apply(type_l3)

        top_n = st.slider("Nombre de clusters affichés", 20, 150, 80, 10)
        df_tree = cluster_summary.head(top_n)

        fig_tree = px.treemap(
            df_tree,
            path=[px.Constant("Tous"), "type_cat", "cluster_label"],
            values="n_articles",
            color="n_articles",
            color_continuous_scale="Teal",
            color_continuous_midpoint=df_tree["n_articles"].median(),
            hover_data={"cluster_id": True},
        )
        fig_tree.update_traces(
            textinfo="label+value",
            hovertemplate="<b>%{label}</b><br>Articles : <b>%{value}</b><extra></extra>",
        )
        fig_tree.update_layout(margin=dict(t=10, b=10), height=600)
        st.plotly_chart(fig_tree, use_container_width=True)

    # ── Bubble chart ──
    with tab2:
        st.markdown("Top N clusters · Taille = nombre d'articles · Hover pour le thème")

        top_b = st.slider("Nombre de clusters", 10, 50, 25, 5, key="bubble_n")
        df_top = cluster_summary.head(top_b).reset_index(drop=True)

        N_COLS  = 5
        spacing = float(np.sqrt(df_top["n_articles"].max()) * 1.8)
        gx      = (df_top.index % N_COLS) * spacing
        gy      = -(df_top.index // N_COLS) * spacing

        palette = (px.colors.qualitative.Pastel + px.colors.qualitative.Safe
                    + px.colors.qualitative.Set3)
        colors  = [palette[i % len(palette)] for i in range(len(df_top))]

        s_min, s_max = df_top["n_articles"].min(), df_top["n_articles"].max()
        sizes = 30 + 80 * (df_top["n_articles"] - s_min) / max(s_max - s_min, 1)
        texts = df_top["cluster_label"].where(df_top["n_articles"] >= 5, "")

        fig_b = go.Figure(go.Scatter(
            x=gx, y=gy,
            mode="markers+text",
            text=texts,
            textposition="middle center",
            textfont=dict(size=9, color="#222"),
            marker=dict(size=sizes, sizemode="diameter", color=colors,
                        opacity=0.88, line=dict(width=2, color="white")),
            customdata=list(zip(df_top["cluster_label"], df_top["n_articles"])),
            hovertemplate="<b>%{customdata[0]}</b><br>Articles : <b>%{customdata[1]}</b><extra></extra>",
            showlegend=False,
        ))
        fig_b.update_layout(
            xaxis=dict(visible=False), yaxis=dict(visible=False),
            plot_bgcolor="white", paper_bgcolor="white",
            height=600, margin=dict(t=10, l=10, r=10, b=10),
        )
        st.plotly_chart(fig_b, use_container_width=True)

    # ── Quasi-doublons ──
    with tab3:
        st.markdown("Paires d'events avec score Sij > 0.90 (0.6×cosine + 0.4×sim_structure)")
        sij_min = st.slider("Score Sij minimum", 0.90, 1.0, 0.95, 0.01)
        df_qf = df_q[df_q["sij"] >= sij_min].sort_values("sij", ascending=False)
        st.markdown(f"**{len(df_qf):,} paires** avec Sij ≥ {sij_min}")
        st.dataframe(
            df_qf,
            use_container_width=True,
            height=400,
            column_config={
                "sij": st.column_config.ProgressColumn("Sij", min_value=0.9, max_value=1.0, format="%.4f"),
                "cosine": st.column_config.NumberColumn("Cosine", format="%.4f"),
                "sim_structure": st.column_config.NumberColumn("Struct", format="%.4f"),
            },
        )

    # ── Doublons intra-cluster ──
    with tab4:
        df_da = load_doublons_articles()
        if df_da.empty:
            st.warning(
                "Fichier `doublons_articles.csv` introuvable. "
                "Lance d'abord : `python intra_cluster_doublons.py`"
            )
        else:
            st.markdown(
                f"**{len(df_da):,} paires d'articles similaires** détectées à l'intérieur des clusters "
                f"(similarité cosinus ≥ 0.50 entre embeddings d'articles du même cluster)"
            )
            st.divider()

            # Sélection du cluster
            clusters_with_pairs = (
                df_da.groupby(["cluster_id", "cluster_label"])
                .size()
                .reset_index(name="n_paires")
                .sort_values("n_paires", ascending=False)
            )
            clusters_with_pairs["label_display"] = (
                clusters_with_pairs["cluster_label"]
                + "  (" + clusters_with_pairs["n_paires"].astype(str) + " paires)"
            )

            col_sel, col_thr = st.columns([3, 1])
            with col_thr:
                thr = st.slider("Seuil cosinus", 0.50, 1.0, 0.75, 0.01, key="da_thr")
            with col_sel:
                options = ["Tous les clusters"] + clusters_with_pairs["label_display"].tolist()
                choice  = st.selectbox("Cluster à explorer", options)

            # Filtrage
            df_filt = df_da[df_da["cosine"] >= thr].copy()
            if choice != "Tous les clusters":
                selected_label = choice.rsplit("  (", 1)[0]
                df_filt = df_filt[df_filt["cluster_label"] == selected_label]

            df_filt = df_filt.reset_index(drop=True)
            st.markdown(f"**{len(df_filt):,} paires** affichées")

            if df_filt.empty:
                st.info("Aucune paire à ce seuil pour ce cluster.")
            else:
                # ── Paire sélectionnée ──────────────────────────────────────
                pair_options = [
                    f"#{i+1}  cosine={row['cosine']:.4f}  —  {row['cluster_label']}"
                    for i, row in df_filt.iterrows()
                ]
                selected_pair = st.selectbox("Paire à afficher", pair_options, index=0, key="da_pair")
                pair_idx = pair_options.index(selected_pair)
                row = df_filt.iloc[pair_idx]

                c_left, c_right = st.columns(2)
                with c_left:
                    st.markdown(f"**Article 1** — `{row['article_id_1']}`")
                    st.info(row["context_1"] if pd.notna(row["context_1"]) else "*(contexte vide)*")
                with c_right:
                    st.markdown(f"**Article 2** — `{row['article_id_2']}`")
                    st.info(row["context_2"] if pd.notna(row["context_2"]) else "*(contexte vide)*")

                st.divider()

                # Tableau récapitulatif
                st.dataframe(
                    df_filt[["cluster_label", "article_id_1", "article_id_2", "cosine"]],
                    use_container_width=True,
                    height=280,
                    column_config={
                        "cosine": st.column_config.ProgressColumn(
                            "Similarité", min_value=0.50, max_value=1.0, format="%.4f"
                        ),
                        "cluster_label": st.column_config.TextColumn("Cluster", width="medium"),
                        "article_id_1": st.column_config.TextColumn("Article 1", width="medium"),
                        "article_id_2": st.column_config.TextColumn("Article 2", width="medium"),
                    },
                )


# ══════════════════════════════════════════════════════════════════════════════
# VUE 4 — EXPLORATION
# ══════════════════════════════════════════════════════════════════════════════
elif vue == "Exploration":
    st.title("Exploration des events")
    st.caption("Recherche par mot-clé dans le contexte · Détail complet d'un event")

    df_a   = load_anomalies()
    events = load_events()

    # Index rapide id → event
    events_by_id = {
        (e.get("_id", {}).get("$oid", str(e.get("_id", "")))
         if isinstance(e.get("_id"), dict) else str(e.get("_id", ""))): e
        for e in events
    }

    # Recherche
    col1, col2 = st.columns([3, 1])
    with col1:
        query = st.text_input("Rechercher dans le contexte", placeholder="ex: cartel, ukraine, élection…")
    with col2:
        max_results = st.selectbox("Résultats max", [20, 50, 100, 200], index=0)

    if query:
        mask   = df_a["context"].str.contains(query, case=False, na=False)
        df_res = df_a[mask].head(max_results)
        st.markdown(f"**{mask.sum():,} events** contiennent *« {query} »*")

        st.dataframe(
            df_res[["event_id", "type", "score_final", "niveau", "context"]],
            use_container_width=True,
            height=300,
            column_config={
                "score_final": st.column_config.ProgressColumn(
                    "Score", min_value=0, max_value=1, format="%.3f"
                ),
                "context": st.column_config.TextColumn("Contexte", width="large"),
            },
        )

        st.divider()
        st.subheader("Détail complet d'un event")
        if len(df_res):
            selected_id = st.selectbox("Choisir un event", df_res["event_id"].tolist())
            row = df_res[df_res["event_id"] == selected_id].iloc[0]

            c1, c2, c3 = st.columns(3)
            c1.metric("Score anomalie", f"{row['score_final']:.3f}")
            c2.metric("Niveau", row["niveau"])
            c3.metric("Type", row["type"])
            st.info(f"**Explication anomalie :** {row['explication']}")

            event_detail = events_by_id.get(str(selected_id))
            if event_detail:
                with st.expander("Contexte complet", expanded=True):
                    ctx = event_detail.get("context", "")
                    st.write(ctx if ctx else "*(vide)*")

                col_n, col_e = st.columns(2)
                with col_n:
                    st.markdown(f"**Nodes ({len(event_detail.get('nodes', []))})**")
                    for node in event_detail.get("nodes", []):
                        labels = ", ".join(node.get("labels", []))
                        name   = node.get("properties", {}).get("name", "")
                        st.markdown(f"- `{labels}` — {name}")
                with col_e:
                    st.markdown(f"**Edges ({len(event_detail.get('edges', []))})**")
                    for edge in event_detail.get("edges", []):
                        st.markdown(f"- `{edge.get('type', '')}` "
                                    f"({edge.get('startNode', '')} → {edge.get('endNode', '')})")

                with st.expander("JSON brut"):
                    st.json(event_detail)
    else:
        st.info("Entrez un mot-clé pour rechercher dans les events.")

        # Sans recherche : afficher un event aléatoire
        if st.button("Event aléatoire"):
            sample = df_a.sample(1).iloc[0]
            st.metric("Type", sample["type"])
            st.metric("Score", f"{sample['score_final']:.3f}")
            st.write(sample.get("context", ""))
