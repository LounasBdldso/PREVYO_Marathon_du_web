<a name="readme-top"></a>

<div align="center">

# 🕸️ PREVYO : Analyse de Graphe de Connaissances

**Un outil interactif d'analyse de données et de détection d'anomalies basé sur la base de connaissances NLP d'EMVISTA. Développé pendant le Marathon du Web !**

<img src="figure/prevyo.png" alt="Logo PREVYO" width="250" />

</div>

---

## 📃 Table des matières

- [📌 À propos du projet](#-à-propos-du-projet)
- [⭐️ Fonctionnalités](#️-fonctionnalités)
- [🛠 Stack Technique](#-stack-technique)
- [🚀 Installation & Configuration](#-installation--configuration)
- [🌐 Version Dashboard](#-version-dashboard)
- [👥 Équipe du Projet](#-équipe-du-projet)

---

## 📌 À propos du projet

**PREVYO Analytics** est un projet open-source d'analyse de données développé lors d'un hackathon de 48h (Marathon du Web) en collaboration avec l'entreprise EMVISTA. L'objectif de ce projet est d'analyser la base de connaissances complexe PREVYO, générée par des algorithmes NLP à partir de textes bruts, afin d'en extraire des informations exploitables.

Plutôt que d'extraire le texte nous-mêmes, nous avons construit un pipeline de données complet pour auditer le graphe existant, détecter les anomalies structurelles, trouver des similarités sémantiques entre les événements et visualiser l'ensemble du réseau dans un tableau de bord interactif.

---

## ⭐️ Fonctionnalités

- 🧹 **Parsing JSON vers Graphe** : Aplatissement automatisé des données JSON imbriquées vers des formats tabulaires exploitables.
- 🗄️ **Intégration ArangoDB** : Mise en place d'une base de données orientée graphe pour la visualisation et l'exploration des sous-graphes.
- 📊 **Analyse Exploratoire des Données (EDA)** : Treemaps, Heatmaps et analyse temporelle des distributions d'événements.
- 🚨 **Détection d'Anomalies** : Algorithmes de machine learning non-supervisé pour identifier les nœuds isolés et les valeurs aberrantes structurelles.
- 🔗 **Similarité & Clustering** : Regroupement d'événements similaires et détection de quasi-doublons grâce à des embeddings sémantiques avancés.
- 📈 **Tableau de Bord Interactif** : Une interface Streamlit intuitive pour explorer les KPIs, les clusters et les alertes en temps réel.

*[Image / Capture d'écran de vos visualisations ou du dashboard - à rajouter plus tard]*

---

## 🛠 Stack Technique

| Composant        | Technologie Utilisée             |
|------------------|-----------------------------|
| 🐍 **Langage** | Python 3.10+                |
| 🐼 **Préparation Data** | pandas, networkx |
| 🧠 **NLP & ML** | scikit-learn (Isolation Forest, DBSCAN), sentence-transformers, hdbscan, umap-learn |
| 🗃 **Base de données** | ArangoDB                    |
| 📊 **Dataviz** | Plotly Express, Folium |
| 🌍 **App/UI** | Streamlit       |

---

## 🚀 Installation & Configuration

*[Section en cours de rédaction]*

---

## 🌐 Version Dashboard

*[Section en cours de rédaction]*

---

## 👥 Équipe du Projet

Ce projet a été réalisé par une équipe pluridisciplinaire réunissant des étudiants en Data Science (MIASHS) et en Communication (INFOCOM).

| Nom                     | Rôle / Expertise                                      |
|--------------------------|-------------------------------------------------------|
| **Lounas Chikhi** | 👑 Chef de Projet & Data Analytics                  |
| **Combes-Aguéra Anthony** | ⚙️ Data Engineering & Intégration ArangoDB           |
| **Akkouh Ayoub** | 🧠 Machine Learning (Détection d'Anomalies & Clustering) |
| **Mekki Ryan** | 📊 Dataviz & Développement Dashboard Streamlit         |
| **Équipe INFOCOM** | 🎨 UI/UX, Trailer Vidéo, Pitch & Communication Print  |

---