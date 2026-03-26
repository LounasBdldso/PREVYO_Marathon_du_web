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
import copy
import numpy as np
import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import networkx as nx
from pathlib import Path
from collections import Counter
from datetime import datetime

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
def load_event_pairs():
    p = BASE / "event_pairs.csv"
    if p.exists():
        return pd.read_csv(p)
    return pd.DataFrame()

@st.cache_data
def load_event_pairs_detail():
    p = BASE / "event_pairs_sample.json"
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return []

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
        ["Tableau de bord", "Anomalies", "Similarité", "Graphes", "Exploration", "Fusion manuelle"],
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
# VUE 4 — GRAPHES (pipeline similarité / fusion)
# ══════════════════════════════════════════════════════════════════════════════
elif vue == "Graphes":
    st.title("Pipeline graphes — Similarité, Fusion, Contradiction")
    st.caption(
        "Vecteur par EventEntity = embedding(context) + features sourceNode (polarity, tense, mood, aspect) + edge types · "
        "Décision : FUSION · ENRICHISSEMENT · CONTRADICTION · SIMILAIRE"
    )

    df_ep = load_event_pairs()
    detail = load_event_pairs_detail()

    if df_ep.empty:
        st.warning(
            "Fichier `event_pairs.csv` introuvable. "
            "Lance d'abord : `python event_graph_pipeline.py`"
        )
    else:
        # KPIs
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Paires analysées",   f"{len(df_ep):,}")
        c2.metric("FUSION",             f"{(df_ep['decision']=='FUSION').sum():,}",
                  help="Même événement vu par 2 sources — sim > 0.90, 0 conflit")
        c3.metric("ENRICHISSEMENT",     f"{(df_ep['decision']=='ENRICHISSEMENT').sum():,}",
                  help="Infos complémentaires — sim > 0.75, pas de conflit")
        c4.metric("CONTRADICTION",      f"{(df_ep['decision']=='CONTRADICTION').sum():,}",
                  help="Similarité élevée mais propriétés incompatibles")
        c5.metric("Conflits détectés",
                  f"{(df_ep['pol_conflict'] | df_ep['tense_conflict'] | df_ep['date_conflict']).sum():,}")

        st.divider()
        tab_g1, tab_g2, tab_g3 = st.tabs(["Décisions", "Conflits", "Détail paires"])

        # ── Tab 1 : vue d'ensemble des décisions ──
        with tab_g1:
            col_a, col_b = st.columns(2)

            with col_a:
                counts = df_ep["decision"].value_counts().reset_index()
                counts.columns = ["decision", "n"]
                fig_dec = px.bar(
                    counts, x="decision", y="n",
                    color="decision",
                    color_discrete_map={
                        "FUSION"         : "#2ecc71",
                        "ENRICHISSEMENT" : "#3498db",
                        "CONTRADICTION"  : "#e74c3c",
                        "SIMILAIRE"      : "#bdc3c7",
                    },
                    labels={"n": "Nombre de paires", "decision": ""},
                    title="Répartition des décisions",
                )
                fig_dec.update_layout(showlegend=False, height=350, margin=dict(t=40, b=10))
                st.plotly_chart(fig_dec, use_container_width=True)

            with col_b:
                intra = df_ep["same_article"].sum()
                inter = (~df_ep["same_article"]).sum()
                fig_ia = px.pie(
                    values=[intra, inter],
                    names=["Intra-article", "Inter-articles"],
                    color_discrete_sequence=["#9b59b6", "#e67e22"],
                    title="Paires intra vs inter articles",
                    hole=0.4,
                )
                fig_ia.update_layout(height=350, margin=dict(t=40, b=10))
                st.plotly_chart(fig_ia, use_container_width=True)

            # Distribution des scores de similarité par décision
            fig_hist = px.histogram(
                df_ep, x="sim", color="decision", nbins=50,
                color_discrete_map={
                    "FUSION"         : "#2ecc71",
                    "ENRICHISSEMENT" : "#3498db",
                    "CONTRADICTION"  : "#e74c3c",
                    "SIMILAIRE"      : "#bdc3c7",
                },
                barmode="overlay", opacity=0.7,
                labels={"sim": "Score de similarité", "count": "Paires"},
                title="Distribution des scores par décision",
            )
            fig_hist.update_layout(height=320, margin=dict(t=40, b=10))
            st.plotly_chart(fig_hist, use_container_width=True)

        # ── Tab 2 : conflits ──
        with tab_g2:
            df_conf = df_ep[
                df_ep["pol_conflict"] | df_ep["tense_conflict"] | df_ep["date_conflict"]
            ].copy()
            st.markdown(f"**{len(df_conf):,} paires en conflit**")

            col_f, col_s = st.columns([2, 1])
            with col_f:
                type_filter = st.multiselect(
                    "Type de conflit",
                    ["Polarité", "Tense", "Date"],
                    default=["Polarité", "Tense", "Date"],
                )
            with col_s:
                sim_conf = st.slider("Sim minimum", 0.50, 1.0, 0.75, 0.01, key="conf_sim")

            df_conf = df_ep[df_ep["sim"] >= sim_conf].copy()
            mask = pd.Series(False, index=df_conf.index)
            if "Polarité" in type_filter: mask |= df_conf["pol_conflict"]
            if "Tense"    in type_filter: mask |= df_conf["tense_conflict"]
            if "Date"     in type_filter: mask |= df_conf["date_conflict"]
            df_conf = df_conf[mask].sort_values("sim", ascending=False)

            st.dataframe(
                df_conf[[
                    "sim", "decision", "type_a", "type_b",
                    "polarity_a", "polarity_b", "tense_a", "tense_b",
                    "pol_conflict", "tense_conflict", "date_conflict",
                    "context_a", "context_b",
                ]].head(300),
                use_container_width=True,
                height=380,
                column_config={
                    "sim": st.column_config.ProgressColumn(
                        "Sim", min_value=0.7, max_value=1.0, format="%.3f"
                    ),
                    "context_a": st.column_config.TextColumn("Contexte A", width="large"),
                    "context_b": st.column_config.TextColumn("Contexte B", width="large"),
                },
            )

        # ── Tab 3 : détail paires côte-à-côte ──
        with tab_g3:
            dec_filter = st.selectbox(
                "Décision",
                ["FUSION", "ENRICHISSEMENT", "CONTRADICTION", "SIMILAIRE", "Toutes"],
                index=0,
            )
            sim_min = st.slider("Sim minimum", 0.50, 1.0, 0.75, 0.01, key="pair_sim")

            df_view = df_ep[df_ep["sim"] >= sim_min].copy()
            if dec_filter != "Toutes":
                df_view = df_view[df_view["decision"] == dec_filter]
            df_view = df_view.sort_values("sim", ascending=True).reset_index(drop=True)

            st.markdown(f"**{len(df_view):,} paires**")

            if not df_view.empty:
                pair_labels = [
                    f"#{i+1}  sim={row['sim']:.4f}  {row['decision']}  [{row['type_a']} / {row['type_b']}]"
                    for i, row in df_view.iterrows()
                ]
                sel = st.selectbox("Choisir une paire", pair_labels, index=0, key="pair_sel")
                idx = pair_labels.index(sel)
                row = df_view.iloc[idx]

                # Badge couleur décision
                dec_colors = {
                    "FUSION"         : "#d5f5e3",
                    "ENRICHISSEMENT" : "#d6eaf8",
                    "CONTRADICTION"  : "#fde8e8",
                    "SIMILAIRE"      : "#f2f3f4",
                }
                bg = dec_colors.get(row["decision"], "#fff")
                st.markdown(
                    f'<div style="background:{bg};padding:10px 16px;border-radius:6px;'
                    f'margin-bottom:12px;font-size:15px">'
                    f'<b>Décision : {row["decision"]}</b> · '
                    f'Similarité : <b>{row["sim"]:.4f}</b> · '
                    f'Nodes communs : <b>{row["n_common_nodes"]}</b> · '
                    f'Conflits : polarité={row["pol_conflict"]} | '
                    f'tense={row["tense_conflict"]} | date={row["date_conflict"]}'
                    f'</div>',
                    unsafe_allow_html=True,
                )

                c_left, c_right = st.columns(2)
                with c_left:
                    st.markdown(
                        f"**Event A** · type={row['type_a']} · "
                        f"polarity=`{row['polarity_a']}` · tense=`{row['tense_a']}`  \n"
                        f"article : `{row['article_id_a']}`"
                    )
                    st.info(row["context_a"] if pd.notna(row["context_a"]) else "*(vide)*")
                with c_right:
                    st.markdown(
                        f"**Event B** · type={row['type_b']} · "
                        f"polarity=`{row['polarity_b']}` · tense=`{row['tense_b']}`  \n"
                        f"article : `{row['article_id_b']}`"
                    )
                    st.info(row["context_b"] if pd.notna(row["context_b"]) else "*(vide)*")

                # Nodes communs / exclusifs (depuis le JSON détaillé si dispo)
                detail_row = next(
                    (d for d in detail
                     if d["event_id_a"] == row["event_id_a"]
                     and d["event_id_b"] == row["event_id_b"]),
                    None,
                )
                if detail_row:
                    st.divider()
                    cd1, cd2, cd3 = st.columns(3)
                    with cd1:
                        st.markdown("**Nodes communs**")
                        for f in detail_row.get("common_forms", []):
                            st.markdown(f"- `{f}`")
                    with cd2:
                        st.markdown("**Uniquement dans A**")
                        for f in detail_row.get("only_in_a", []):
                            st.markdown(f"- `{f}`")
                    with cd3:
                        st.markdown("**Uniquement dans B**")
                        for f in detail_row.get("only_in_b", []):
                            st.markdown(f"- `{f}`")


# ══════════════════════════════════════════════════════════════════════════════
# VUE 5 — EXPLORATION
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


# ══════════════════════════════════════════════════════════════════════════════
# VUE 6 — FUSION MANUELLE
# ══════════════════════════════════════════════════════════════════════════════
elif vue == "Fusion manuelle":
    st.title("Fusion manuelle de graphes")
    st.caption(
        "Sélectionne une paire d'articles similaires · "
        "Visualise leurs graphes · Fusionne ou supprime des nœuds · Exporte le JSON"
    )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def oid(event):
        """Retourne l'_id string d'un event."""
        raw = event.get("_id", "")
        if isinstance(raw, dict):
            return raw.get("$oid", str(raw))
        return str(raw)

    def short_label(node):
        """Étiquette courte pour un nœud."""
        form = node.get("form", "")
        labels = node.get("labels", [])
        lbl = labels[-1].split("/")[-1] if labels else ""
        return f"{form}\n[{lbl}]" if lbl else form

    def short_label_inline(node):
        form = node.get("form", "?")
        labels = node.get("labels", [])
        lbl = labels[-1].split("/")[-1] if labels else ""
        return f"{form} [{lbl}]" if lbl else form

    def build_plotly_graph(event, title, highlight_ids=None):
        """
        Construit un graphe Plotly (Scatter) depuis un event.
        highlight_ids : set de _id à mettre en évidence (orange).
        """
        nodes = event.get("nodes", [])
        edges = event.get("edges", [])
        if not nodes:
            fig = go.Figure()
            fig.update_layout(title=title, height=380)
            return fig

        G = nx.DiGraph()
        for n in nodes:
            G.add_node(str(n["_id"]), **n)
        for e in edges:
            src, tgt = str(e.get("source", "")), str(e.get("target", ""))
            if src in G and tgt in G:
                G.add_edge(src, tgt, label=e.get("type", ""))

        pos = nx.spring_layout(G, seed=42, k=2.5)

        # Arêtes
        edge_x, edge_y = [], []
        edge_labels_x, edge_labels_y, edge_labels_text = [], [], []
        for u, v, data in G.edges(data=True):
            x0, y0 = pos[u]
            x1, y1 = pos[v]
            edge_x += [x0, x1, None]
            edge_y += [y0, y1, None]
            edge_labels_x.append((x0 + x1) / 2)
            edge_labels_y.append((y0 + y1) / 2)
            edge_labels_text.append(data.get("label", ""))

        edge_trace = go.Scatter(
            x=edge_x, y=edge_y,
            mode="lines",
            line=dict(width=1.5, color="#aaaaaa"),
            hoverinfo="none",
            showlegend=False,
        )
        edge_label_trace = go.Scatter(
            x=edge_labels_x, y=edge_labels_y,
            mode="text",
            text=edge_labels_text,
            textfont=dict(size=9, color="#888"),
            hoverinfo="none",
            showlegend=False,
        )

        # Nœuds
        node_x, node_y, node_text, node_hover, node_color = [], [], [], [], []
        hl = highlight_ids or set()
        for nid, data in G.nodes(data=True):
            x, y = pos[nid]
            node_x.append(x)
            node_y.append(y)
            node_text.append(short_label(data))
            props = data.get("properties", {})
            node_hover.append(
                f"<b>{data.get('form','')}</b><br>"
                f"ID: {nid}<br>"
                f"Labels: {', '.join(data.get('labels', []))}<br>"
                + "<br>".join(f"{k}: {v}" for k, v in props.items())
            )
            node_color.append("#e67e22" if nid in hl else "#3498db")

        node_trace = go.Scatter(
            x=node_x, y=node_y,
            mode="markers+text",
            text=node_text,
            textposition="top center",
            textfont=dict(size=10),
            marker=dict(size=22, color=node_color,
                        line=dict(width=2, color="white")),
            hovertext=node_hover,
            hoverinfo="text",
            showlegend=False,
        )

        fig = go.Figure(data=[edge_trace, edge_label_trace, node_trace])
        fig.update_layout(
            title=dict(text=title, font=dict(size=13)),
            height=400,
            margin=dict(t=40, l=10, r=10, b=10),
            xaxis=dict(visible=False),
            yaxis=dict(visible=False),
            plot_bgcolor="white",
            paper_bgcolor="white",
        )
        return fig

    # ── Chargement données ────────────────────────────────────────────────────

    @st.cache_data
    def load_all_events_indexed():
        with open(BASE / "export.events.json", encoding="utf-8") as f:
            evs = json.load(f)
        # Index par resultAnalyseId (= article_id)
        idx = {}
        for e in evs:
            art = str(e.get("resultAnalyseId", ""))
            idx.setdefault(art, []).append(e)
        return idx

    df_da = load_doublons_articles()
    if df_da.empty:
        st.warning(
            "Fichier `doublons_articles.csv` introuvable. "
            "Lance d'abord : `python intra_cluster_doublons.py`"
        )
        st.stop()

    events_by_article = load_all_events_indexed()

    # ── Session state ─────────────────────────────────────────────────────────
    # On stocke les copies de travail des deux events sélectionnés.

    if "fm_event_a" not in st.session_state:
        st.session_state.fm_event_a = None
    if "fm_event_b" not in st.session_state:
        st.session_state.fm_event_b = None
    if "fm_history" not in st.session_state:
        st.session_state.fm_history = []   # [(snapshot_a, snapshot_b, description)]

    def push_history(desc):
        st.session_state.fm_history.append((
            copy.deepcopy(st.session_state.fm_event_a),
            copy.deepcopy(st.session_state.fm_event_b),
            desc,
        ))

    def undo():
        if st.session_state.fm_history:
            prev_a, prev_b, _ = st.session_state.fm_history.pop()
            st.session_state.fm_event_a = prev_a
            st.session_state.fm_event_b = prev_b

    # ── Sélection de la paire ─────────────────────────────────────────────────

    st.subheader("1 · Choisir une paire d'articles")

    col_thr, col_pair = st.columns([1, 3])
    with col_thr:
        thr = st.slider("Seuil cosinus", 0.50, 1.0, 0.90, 0.01, key="fm_thr")
    df_pairs = df_da[df_da["cosine"] >= thr].reset_index(drop=True)

    if df_pairs.empty:
        st.info("Aucune paire à ce seuil.")
        st.stop()

    pair_labels = [
        f"#{i+1}  cos={row['cosine']:.3f}  [{row['cluster_label']}]  "
        f"{row['article_id_1'][:8]}… / {row['article_id_2'][:8]}…"
        for i, row in df_pairs.iterrows()
    ]
    with col_pair:
        sel_pair = st.selectbox("Paire", pair_labels, key="fm_pair_sel")

    pair_idx = pair_labels.index(sel_pair)
    pair_row = df_pairs.iloc[pair_idx]
    art1, art2 = str(pair_row["article_id_1"]), str(pair_row["article_id_2"])

    evs1 = events_by_article.get(art1, [])
    evs2 = events_by_article.get(art2, [])

    if not evs1 or not evs2:
        st.warning("Events introuvables pour cette paire dans export.events.json.")
        st.stop()

    col_e1, col_e2 = st.columns(2)
    with col_e1:
        opts1 = [f"Event {i+1} — {e.get('type','').split('/')[-1]} ({len(e.get('nodes',[]))}N)"
                 for i, e in enumerate(evs1)]
        sel1 = st.selectbox("Event article A", opts1, key="fm_sel_e1")
        ev_a_src = evs1[opts1.index(sel1)]
    with col_e2:
        opts2 = [f"Event {i+1} — {e.get('type','').split('/')[-1]} ({len(e.get('nodes',[]))}N)"
                 for i, e in enumerate(evs2)]
        sel2 = st.selectbox("Event article B", opts2, key="fm_sel_e2")
        ev_b_src = evs2[opts2.index(sel2)]

    # Bouton pour charger / réinitialiser les copies de travail
    col_load, col_reset = st.columns([1, 1])
    with col_load:
        if st.button("Charger ces events", type="primary"):
            st.session_state.fm_event_a = copy.deepcopy(ev_a_src)
            st.session_state.fm_event_b = copy.deepcopy(ev_b_src)
            st.session_state.fm_history = []
            st.rerun()
    with col_reset:
        if st.session_state.fm_event_a is not None:
            if st.button("Reinitialiser"):
                st.session_state.fm_event_a = copy.deepcopy(ev_a_src)
                st.session_state.fm_event_b = copy.deepcopy(ev_b_src)
                st.session_state.fm_history = []
                st.rerun()

    if st.session_state.fm_event_a is None:
        st.info("Clique sur **Charger ces events** pour commencer.")
        st.stop()

    ev_a = st.session_state.fm_event_a
    ev_b = st.session_state.fm_event_b

    st.divider()

    # ── Visualisation ─────────────────────────────────────────────────────────

    st.subheader("2 · Graphes")

    nodes_a = ev_a.get("nodes", [])
    nodes_b = ev_b.get("nodes", [])
    ids_a = {str(n["_id"]) for n in nodes_a}
    ids_b = {str(n["_id"]) for n in nodes_b}
    shared_ids = ids_a & ids_b

    gc1, gc2 = st.columns(2)
    with gc1:
        fig_a = build_plotly_graph(
            ev_a,
            f"Article A · {ev_a.get('type','').split('/')[-1]}",
            highlight_ids=shared_ids,
        )
        st.plotly_chart(fig_a, use_container_width=True)
        st.caption(f"{len(nodes_a)} nœuds · {len(ev_a.get('edges',[]))} arêtes")

    with gc2:
        fig_b = build_plotly_graph(
            ev_b,
            f"Article B · {ev_b.get('type','').split('/')[-1]}",
            highlight_ids=shared_ids,
        )
        st.plotly_chart(fig_b, use_container_width=True)
        st.caption(f"{len(nodes_b)} nœuds · {len(ev_b.get('edges',[]))} arêtes")

    if shared_ids:
        st.success(
            f"{len(shared_ids)} nœud(s) déjà partagé(s) entre les deux events "
            f"(affiché(s) en orange) : "
            + ", ".join(f"`{sid}`" for sid in list(shared_ids)[:5])
        )

    st.divider()

    # ── Actions ───────────────────────────────────────────────────────────────

    st.subheader("3 · Actions")

    tab_merge, tab_delete, tab_edge = st.tabs(["Fusionner deux nœuds", "Supprimer un nœud", "Créer une arête"])

    # ── Tab : Fusionner ────────────────────────────────────────────────────────
    with tab_merge:
        st.markdown(
            "Choisis le **nœud canonique** (on le garde dans son event) "
            "et le **nœud à absorber** (supprimé de son event, ses arêtes redirigées vers le canonique)."
        )

        # Index _id → event source
        ids_in_a = {str(n["_id"]) for n in nodes_a}
        ids_in_b = {str(n["_id"]) for n in nodes_b}

        def node_label(nid, node, src):
            return f"[Event {src}] {short_label_inline(node)} — id:{nid[:12]}"

        all_node_opts = {}
        for n in nodes_a:
            nid = str(n["_id"])
            all_node_opts[nid] = node_label(nid, n, "A")
        for n in nodes_b:
            nid = str(n["_id"])
            if nid not in all_node_opts:
                all_node_opts[nid] = node_label(nid, n, "B")

        mc1, mc2 = st.columns(2)
        with mc1:
            st.markdown("**Nœud canonique** — reste dans son event")
            canon_sel = st.selectbox(
                "Canonique",
                options=list(all_node_opts.keys()),
                format_func=lambda x: all_node_opts[x],
                key="fm_canon",
                label_visibility="collapsed",
            )
        with mc2:
            st.markdown("**Nœud à absorber** — supprimé, arêtes → canonique")
            absorb_opts = {k: v for k, v in all_node_opts.items() if k != canon_sel}
            if absorb_opts:
                absorb_sel = st.selectbox(
                    "A absorber",
                    options=list(absorb_opts.keys()),
                    format_func=lambda x: absorb_opts[x],
                    key="fm_absorb",
                    label_visibility="collapsed",
                )
            else:
                absorb_sel = None
                st.info("Pas d'autre nœud disponible.")

        if absorb_sel and st.button("Fusionner", type="primary", key="btn_merge"):
            push_history(f"Fusion {absorb_sel[:8]} → {canon_sel[:8]}")

            # Déterminer l'event qui contient le nœud absorbé
            event_with_absorb = ev_a if absorb_sel in ids_in_a else ev_b

            # Rediriger les arêtes de l'absorbé vers le canonique dans cet event
            for edge in event_with_absorb.get("edges", []):
                if str(edge.get("source", "")) == absorb_sel:
                    edge["source"] = canon_sel
                if str(edge.get("target", "")) == absorb_sel:
                    edge["target"] = canon_sel

            # Supprimer les auto-boucles créées si canon == absorb cible
            event_with_absorb["edges"] = [
                e for e in event_with_absorb["edges"]
                if str(e.get("source", "")) != str(e.get("target", ""))
            ]

            # Supprimer le nœud absorbé de son event
            event_with_absorb["nodes"] = [
                n for n in event_with_absorb["nodes"]
                if str(n["_id"]) != absorb_sel
            ]

            st.rerun()

    # ── Tab : Supprimer ───────────────────────────────────────────────────────
    with tab_delete:
        st.markdown("Supprime un nœud **et toutes ses arêtes** dans l'event sélectionné.")

        del_src = st.radio("Event cible", ["A", "B"], horizontal=True, key="fm_del_src")
        target_event = ev_a if del_src == "A" else ev_b
        target_nodes = target_event.get("nodes", [])

        if not target_nodes:
            st.info("Aucun nœud dans cet event.")
        else:
            del_options = {str(n["_id"]): short_label_inline(n) for n in target_nodes}
            del_sel = st.selectbox(
                "Nœud à supprimer",
                options=list(del_options.keys()),
                format_func=lambda x: del_options[x],
                key="fm_del_node",
            )

            st.warning(
                f"Supprimer **{del_options[del_sel]}** supprimera aussi "
                f"toutes les arêtes connectées."
            )

            if st.button("Supprimer", type="primary", key="btn_delete"):
                push_history(f"Suppression nœud {del_sel[:8]} dans event {del_src}")
                target_event["nodes"] = [
                    n for n in target_event["nodes"] if str(n["_id"]) != del_sel
                ]
                target_event["edges"] = [
                    e for e in target_event["edges"]
                    if str(e.get("source", "")) != del_sel
                    and str(e.get("target", "")) != del_sel
                ]
                st.rerun()

    # ── Tab : Créer une arête ─────────────────────────────────────────────────
    with tab_edge:
        st.markdown("Crée une arête entre deux nœuds existants dans l'event de ton choix.")

        edge_src_event = st.radio("Event cible", ["A", "B"], horizontal=True, key="fm_edge_event")
        target_event_edge = ev_a if edge_src_event == "A" else ev_b
        edge_nodes = target_event_edge.get("nodes", [])

        if len(edge_nodes) < 2:
            st.info("Il faut au moins 2 nœuds dans l'event pour créer une arête.")
        else:
            node_opts = {str(n["_id"]): short_label_inline(n) for n in edge_nodes}

            ec1, ec2, ec3 = st.columns(3)
            with ec1:
                st.markdown("**Source**")
                edge_from = st.selectbox(
                    "Source",
                    options=list(node_opts.keys()),
                    format_func=lambda x: node_opts[x],
                    key="fm_edge_from",
                    label_visibility="collapsed",
                )
            with ec2:
                st.markdown("**Target**")
                to_opts = {k: v for k, v in node_opts.items() if k != edge_from}
                edge_to = st.selectbox(
                    "Target",
                    options=list(to_opts.keys()),
                    format_func=lambda x: to_opts[x],
                    key="fm_edge_to",
                    label_visibility="collapsed",
                )
            with ec3:
                st.markdown("**Type de relation**")
                edge_type = st.text_input(
                    "Type",
                    value="RelatedTo",
                    key="fm_edge_type",
                    label_visibility="collapsed",
                )

            # Vérifier si l'arête existe déjà
            already = any(
                str(e.get("source", "")) == edge_from and str(e.get("target", "")) == edge_to
                for e in target_event_edge.get("edges", [])
            )
            if already:
                st.warning("Cette arête existe déjà.")

            if st.button("Créer l'arête", type="primary", key="btn_edge", disabled=already):
                push_history(f"Arête {edge_type} : {edge_from[:8]} → {edge_to[:8]} dans event {edge_src_event}")
                existing_edge_ids = [
                    int(e["_id"]) for e in target_event_edge.get("edges", [])
                    if str(e.get("_id", "")).isdigit()
                ]
                new_edge_id = str(max(existing_edge_ids) + 1) if existing_edge_ids else "0"
                target_event_edge.setdefault("edges", []).append({
                    "_id": new_edge_id,
                    "type": edge_type.strip(),
                    "source": edge_from,
                    "target": edge_to,
                    "properties": {},
                })
                st.rerun()

    st.divider()

    # ── Historique + Annuler ──────────────────────────────────────────────────

    st.subheader("4 · Historique des modifications")

    if not st.session_state.fm_history:
        st.caption("Aucune modification pour l'instant.")
    else:
        for i, (_, _, desc) in enumerate(reversed(st.session_state.fm_history)):
            st.markdown(f"- `{i+1}.` {desc}")
        if st.button("Annuler la derniere action"):
            undo()
            st.rerun()

    st.divider()

    # ── Export JSON ───────────────────────────────────────────────────────────

    st.subheader("5 · Editer et exporter le JSON")

    st.markdown("Modifie directement le JSON ci-dessous, puis applique les changements avant d'exporter.")

    tab_ja, tab_jb = st.tabs(["Event A", "Event B"])

    def json_editor(event_key, event_obj, tab):
        with tab:
            raw = json.dumps(event_obj, ensure_ascii=False, indent=2, default=str)
            edited = st.text_area(
                "JSON",
                value=raw,
                height=400,
                key=f"fm_json_{event_key}",
                label_visibility="collapsed",
            )
            col_apply, col_err = st.columns([1, 3])
            with col_apply:
                if st.button("Appliquer les modifications", key=f"fm_apply_{event_key}"):
                    try:
                        parsed = json.loads(edited)
                        push_history(f"Edition JSON manuelle event {event_key.upper()}")
                        st.session_state[f"fm_event_{event_key}"] = parsed
                        st.rerun()
                    except json.JSONDecodeError as e:
                        st.error(f"JSON invalide : {e}")

    json_editor("a", ev_a, tab_ja)
    json_editor("b", ev_b, tab_jb)

    st.divider()
    st.markdown("**Enregistrer dans export.events.json**")
    st.caption("Les deux events modifiés remplacent leurs versions originales dans le vrai fichier. Un backup est créé automatiquement.")

    if st.button("Enregistrer dans export.events.json", type="primary"):
        src_file = BASE / "export.events.json"

        # Backup horodaté
        backup = BASE / f"export.events.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        backup.write_bytes(src_file.read_bytes())

        # Charger le vrai fichier (sans cache pour avoir la version actuelle)
        with open(src_file, encoding="utf-8") as f:
            all_events = json.load(f)

        # Construire un index _id → position dans la liste
        id_a = oid(ev_a)
        id_b = oid(ev_b)
        updated = 0
        for i, e in enumerate(all_events):
            e_oid = oid(e)
            if e_oid == id_a:
                all_events[i] = ev_a
                updated += 1
            elif e_oid == id_b:
                all_events[i] = ev_b
                updated += 1

        if updated == 0:
            st.error("Aucun event trouvé dans export.events.json avec ces _id. Backup créé mais fichier non modifié.")
        else:
            with open(src_file, "w", encoding="utf-8") as f:
                json.dump(all_events, f, ensure_ascii=False, indent=2, default=str)
            # Invalider le cache Streamlit pour que le rechargement prenne en compte les nouvelles données
            load_all_events_indexed.clear()
            st.success(f"{updated} event(s) mis à jour dans `export.events.json`. Backup : `{backup.name}`")
