# CentreManager

Application de gestion de centres de soutien scolaire, en français et en arabe. L'interface React/TypeScript utilise Tauri et SQLite pour la version de bureau.

## Installation et exécution

Prérequis : Node.js et npm, Rust stable et les dépendances système de Tauri 2. Sous Windows, installer les outils de build C++ et WebView2. SQLite est fourni par `rusqlite` avec la fonctionnalité `bundled`.

```bash
npm ci
npm run dev           # interface de développement dans le navigateur : port 1420
npm run build         # vérification TypeScript et bundle de production
npm run check:i18n    # vérification des traductions FR/AR
npm run tauri dev     # application de bureau en développement
npm run tauri build   # application de bureau de production
```

En mode navigateur, un backend de développement persiste les données dans le stockage local du navigateur. La première utilisation ouvre l'écran de configuration ; aucune donnée fictive n'est chargée.

## Données et sauvegardes

La version de bureau utilise une base SQLite persistante et applique ses migrations au démarrage. En production, elle se trouve dans le répertoire de données de l'application ; le chemin peut être consulté dans les paramètres. La version Tauri de développement conserve son chemin historique `test-data/centremanager-dev.db` : le dossier est recréé au besoin et cette base locale est ignorée par Git. Les bases existantes ne sont ni remplacées ni réinitialisées au démarrage. Les niveaux, matières et autres données de référence sont initialisés pour une nouvelle base.

Utilisez la fonction de sauvegarde des paramètres avant toute opération de maintenance. Les données historiques d'activités et de règlements restent dans les bases existantes, même lorsque leurs anciens écrans ne sont plus utilisés.

## Structure

- `src/` : interface, composants, services et traductions.
- `src-tauri/src/commands/` : commandes Tauri et règles métier.
- `src-tauri/src/db/` : schéma SQLite, migrations et initialisation.
- `src-tauri/src/models/` : modèles échangés avec l'interface.
- `scripts/check-i18n.mjs` : contrôle des traductions.
- `tools/generate_icons.py` : génération des icônes de l'application.
