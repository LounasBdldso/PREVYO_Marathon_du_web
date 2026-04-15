<a name="readme-top"></a>

<div align="center">

# PREVYO : Analyse de Graphe de Connaissances

**Un outil interactif d'analyse de données et de détection d'anomalies basé sur la base de connaissances NLP d'EMVISTA, développé pendant le Marathon du Web.**

<img src="figures/prevyo.png" alt="Logo PREVYO" width="250" />

</div>

## 📃 Table des matières

- [📌 À propos du projet](#-à-propos-du-projet)
- [⚙️ Fonctionnalités](#️-fonctionnalités)
- [🛠️ Stack technique](#️-stack-technique)
- [🚀 Installation et configuration](#-installation-et-configuration)
- [🏗️ Architecture du site](#️-architecture-du-site)
- [👥 Équipe du projet](#-équipe-du-projet)

## 📌 À propos du projet

**PREVYO Analytics** est un projet open-source d'analyse de données développé lors d'un hackathon de 48 heures, le Marathon du Web, en collaboration avec l'entreprise **EMVISTA**.

L'objectif du projet était d'analyser une base de connaissances complexe générée par des algorithmes de NLP à partir de textes bruts, afin d'en extraire des informations exploitables.

Plutôt que d'extraire nous-mêmes les données textuelles, nous avons conçu un pipeline complet permettant :

- d'auditer le graphe existant
- de détecter les anomalies structurelles
- d'identifier des similarités sémantiques entre événements
- de visualiser l'ensemble du réseau dans un tableau de bord interactif

## ⚙️ Fonctionnalités

- **Parsing JSON vers graphe**  
  Transformation automatisée de données JSON imbriquées en formats tabulaires exploitables.

- **Intégration ArangoDB**  
  Mise en place d'une base orientée graphe pour visualiser et explorer les sous-graphes.

- **Analyse exploratoire des données**  
  Treemaps, heatmaps et analyses temporelles des distributions d'événements.

- **Détection d'anomalies**  
  Utilisation d'algorithmes non supervisés pour identifier les nœuds isolés et les structures atypiques.

- **Similarité et clustering**  
  Regroupement d'événements similaires et détection de quasi-doublons à l'aide d'embeddings sémantiques.

- **Tableau de bord interactif**  
  Interface permettant d'explorer les indicateurs clés, les clusters et les alertes.

## 🛠️ Stack technique

| Composant | Technologie utilisée |
|----------|----------------------|
| **Langage** | Python 3.10+ |
| **Préparation des données** | pandas, networkx |
| **NLP et Machine Learning** | scikit-learn, sentence-transformers, hdbscan, umap-learn |
| **Base de données** | ArangoDB |
| **Datavisualisation** | Plotly Express, Folium |
| **Application / UI** | Streamlit |

## 🚀 Installation et configuration

```bash
git clone https://github.com/LounasBdldso/PREVYO_Marathon_du_web.git
cd PREVYO_Marathon_du_web
```

Pour lancer le projet, ouvrez le fichier `index.html` dans votre navigateur ou utilisez une extension comme Live Server dans VS Code.

### Remarques

- Vérifier que tous les fichiers CSS et JavaScript sont bien présents dans les dossiers `css/` et `js/`
- Vérifier que les chemins vers les ressources statiques sont corrects
- En cas de problème d'affichage, lancer le projet via un serveur local plutôt qu'en double-cliquant directement sur `index.html`

## 🏗️ Architecture du site

L'architecture front-end du projet est organisée comme suit :

```text
PREVYO_Marathon_du_web/
├── index.html
├── README.md
├── requirements.txt
├── css/
│   ├── variables.css
│   ├── layout.css
│   ├── demo.css
│   └── treemap.css
├── js/
│   ├── home.js
│   ├── nav.js
│   ├── state.js
│   ├── data.js
│   ├── shared_dataset.js
│   ├── articles.js
│   ├── graph.js
│   ├── inspect.js
│   ├── visu.js
│   ├── fusion.js
│   └── treemap.js
├── app/
│   ├── app.py
│   ├── dashboard_articles.html
│   ├── dashboard_clusters.html
│   ├── graph_explorer_multi.html
│   ├── fusion_noeud.html
│   ├── fusion_similarite.html
│   ├── location_fixer.html
│   ├── Ajout_Country.html
│   ├── treemap.html
│   └── viz_clusters.py
├── data/
│   ├── export.events.json
│   ├── anomalies.csv
│   ├── articles_clustering.csv
│   ├── doublons_articles.csv
│   └── quasi_doublons.csv
├── anomalies_similarite/
│   ├── anomalies.py
│   ├── deduplicate_events.py
│   └── intra_cluster_doublons.py
├── clusters/
│   ├── clustering.py
│   ├── clustering_advanced.py
│   └── cluster_articles.py
├── EDA/
│   ├── analyse_exploratoire.ipynb
│   ├── intro_au_json.ipynb
│   └── reconstruction_de_contexte.ipynb
├── figures/
└── logo/
```

## Équipe du projet

Ce projet a été réalisé par une équipe pluridisciplinaire réunissant des étudiants en Data Science et en Communication.

| Nom | Rôle / Expertise |
|------|-------------------|
| **Lounas Chikhi** | Chef de projet et Data Analytics |
| **Anthony Combes-Aguéra** | Data Engineering et développeur plateforme |
| **Ayoub Akkouh** | Machine Learning, détection d'anomalies et clustering |
| **Ryan Mekki** | Datavisualisation et développement du dashboard |
| **Équipe INFOCOM** | UI/UX, trailer vidéo, pitch et communication print |

---

<p align="right">(<a href="#readme-top">retour en haut</a>)</p>
