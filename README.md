# 🎓 CentreManager

**Guide de référence fonctionnel et technique — version 1.6.0**

**Date de la synthèse : 3 novembre 2026**

CentreManager est une application desktop destinée aux directeurs et administrateurs de centres privés de soutien scolaire au Maroc. Elle réunit dans une interface unique la gestion des élèves, des groupes, des horaires, des enseignants, des encaissements et des dépenses.

La version de bureau fonctionne principalement **hors ligne** : les données métier sont enregistrées localement dans une base SQLite sur le PC. Les liens WhatsApp ouvrent toutefois un service externe et nécessitent une connexion Internet. L'interface est disponible en **français** et en **arabe**, avec prise en charge de l'affichage de droite à gauche (RTL).

> Ce guide décrit le fonctionnement présent dans le projet, pas une feuille de route garantie. Les montants sont présentés en dirhams (DH) ; en base, ils sont stockés en centimes entiers.

## 📑 Sommaire

1. [Architecture et sécurité](#-architecture-et-sécurité)
2. [Prise en main](#-prise-en-main)
3. [Modules de A à Z](#-modules-de-a-à-z)
4. [Fonctionnalités spéciales](#-fonctionnalités-spéciales)
5. [Parcours utilisateur type](#-parcours-utilisateur-type)
6. [Conclusion et limites actuelles](#-conclusion-et-limites-actuelles)
7. [Documentation technique](#-documentation-technique)

## 🏗️ Architecture et sécurité

### Architecture locale

| Couche | Technologies et rôle |
| --- | --- |
| Interface | React et TypeScript pour les écrans et les formulaires |
| Construction et styles | Vite et Tailwind CSS |
| Application desktop | Tauri 2 et commandes Rust |
| Persistance | SQLite, avec migrations au démarrage |
| Documents | Génération locale de PDF et de fichiers Excel |
| Internationalisation | Français et arabe avec i18next et RTL |

L'interface communique avec les commandes Rust locales via Tauri. La base de production se trouve dans le répertoire de données de l'application ; **Paramètres → Sauvegarde** affiche son chemin. Les données de référence nécessaires à une nouvelle installation sont initialisées sans charger de faux élèves ni de transactions fictives.

La version de développement dans un navigateur utilise un backend de remplacement et le stockage local du navigateur : ce n'est **pas** la base SQLite de l'application desktop. Elle ne doit pas servir de base de production.

### Accès et protection

- Au premier lancement, configurez le **nom du centre** et un **mot de passe administrateur** d'au moins quatre caractères. Choisissez de préférence un mot de passe plus robuste.
- Aux lancements suivants, le mot de passe est demandé pour accéder à l'application. Le modèle actuel est celui d'un **administrateur unique**, sans gestion de comptes ou de rôles multiples.
- En version desktop, le mot de passe est stocké sous forme de hachage **Argon2id**, et non en clair. Après trois tentatives infructueuses, une temporisation de 30 secondes s'applique ; cette temporisation est conservée en mémoire pendant l'exécution.
- La session peut être verrouillée manuellement ou après une période d'inactivité réglable : **15 minutes par défaut**, désactivation possible. Le mot de passe peut être modifié dans les paramètres.
- Le mot de passe de l'application ne chiffre pas la base ni les sauvegardes. Protégez également la session du PC, le disque et les copies de sauvegarde.

### Années scolaires

Une seule année est active à la fois. Le sélecteur de la barre latérale et les paramètres permettent de changer d'année après confirmation : les écrans affichent alors les données correspondant à l'année sélectionnée. Les années non actives restent disponibles pour consultation ou réactivation ; elles ne sont pas simplement supprimées lors du changement. Il ne s'agit pas d'une archive en lecture seule : vérifiez toujours l'année active avant de modifier des données.

Sur une base neuve, une première année est créée automatiquement, du **1er septembre au 31 août**, d'après la date locale du PC. Dans **Paramètres → Année scolaire**, vous pouvez en créer une autre avec son libellé et ses dates, puis l'activer explicitement. Les listes Élèves, Groupes et Enseignants proposent, lorsqu'elle existe, une importation sélective depuis l'année précédente.

La suppression d'une année inactive est définitive et entraîne la suppression des données qui lui sont associées, sous réserve des protections prévues pour certains historiques ambigus. L'année active ne peut pas être supprimée. **Sauvegardez avant toute suppression.**

### Corbeille et sauvegardes

Les élèves, enseignants, groupes et dépenses peuvent être placés dans la corbeille avant suppression définitive. La rétention est de 30 jours, avec des règles importantes :

- Un **élève** placé à la corbeille disparaît de toutes les années ; après 30 jours, sa suppression définitive entraîne aussi celle de ses inscriptions, factures, paiements et reçus de toutes les années.
- Pour les autres éléments, ceux qui possèdent un historique financier sont conservés à l'expiration automatique. La suppression manuelle reste définitive. Les règles précises et les effets sont indiqués dans les confirmations.
- La corbeille affiche les éléments associés à l'année active. La purge est déclenchée au chargement puis périodiquement lorsque l'application est ouverte ; ne considérez pas la corbeille comme une sauvegarde.

Dans **Paramètres → Sauvegarde**, choisissez une destination pour créer une copie `.db`. L'application synchronise d'abord le journal SQLite afin d'inclure les modifications validées. Conservez régulièrement une copie hors du PC et protégez-la comme les données originales.

**La restauration est manuelle** : le bouton « Restaurer » permet de sélectionner une sauvegarde et affiche les instructions, mais ne remplace pas automatiquement la base. Relevez le chemin de la base dans les paramètres, faites une sauvegarde de l'état actuel, fermez complètement l'application, remplacez le fichier de base par la copie choisie à ce chemin, puis relancez et vérifiez les données. Cette opération remplace l'état courant ; en cas de doute sur les fichiers SQLite associés, faites intervenir une personne qualifiée.

## 🚀 Prise en main

1. Lancez l'application desktop et créez l'accès administrateur.
2. Vérifiez l'année active dans la barre latérale ; au besoin, créez et activez une autre année dans les paramètres.
3. Renseignez l'identité du centre et son logo, puis vérifiez les matières, niveaux et préférences d'impression.
4. Ajoutez un enseignant, un groupe et un élève, puis inscrivez l'élève au groupe.
5. Gérez les horaires depuis **Emploi du temps**, puis enregistrez les encaissements et dépenses.
6. Faites des sauvegardes régulières et consultez le tableau de bord pour suivre l'activité.

## 🧭 Modules de A à Z

### A. 📊 Tableau de bord

**But :** obtenir une vue rapide de l'activité et des finances pour la période choisie.

**Écran principal :** le tableau de bord comporte un sélecteur de mois, des indicateurs, les échéances, les derniers encaissements et un aperçu des paiements aux enseignants.

**Fonctionnalités clés :** élèves actifs, revenus du mois, taux de recouvrement, groupes actifs, enseignants et total net. Le net correspond aux **encaissements − dépenses − paiements enseignants** ; il ne s'agit pas d'un bénéfice comptable certifié. Les échéances signalent les factures échues ou à venir dans les sept jours ; les lignes permettent d'accéder aux fiches concernées.

**Parcours type :** choisissez le mois, consultez les indicateurs et les alertes, ouvrez une fiche ou la page Paiements pour agir. Les exports disponibles sont **annuels**, depuis les paramètres, et non un export mensuel dédié du tableau de bord.

### B. 👩‍🎓 Gestion des élèves

**But :** centraliser l'identité, les contacts, les inscriptions et le suivi de chaque élève.

**Écrans principaux :** tableau des élèves et fiche détaillée. Le tableau comporte sept colonnes, dont **Contact Élève**, les groupes, l'état de paiement et les actions ; il propose recherche, filtres et pagination. Le contact du tuteur reste distinct et accessible dans la fiche et dans Paiements.

**Création et gestion :** saisissez notamment prénom, nom, niveau, **téléphone élève**, nom et téléphone du tuteur et date d'inscription. Les informations complémentaires permettent d'ajouter, entre autres, branche, établissement, date de naissance, CIN du tuteur, second contact, adresse et notes. Les éventuels doublons font l'objet d'un avertissement non bloquant. Un élève peut être modifié, désactivé ou placé dans la corbeille. Les deux actions WhatsApp de l'en-tête de la fiche ciblent séparément l'élève et le tuteur.

La fiche comporte quatre onglets :

1. **Informations personnelles** — identité, contacts, données administratives et historique des modifications.
2. **Groupes et tarifs** — inscriptions, dates, tarif standard ou personnalisé ; ajout à un ou plusieurs groupes et fin d'inscription.
3. **Historique des paiements** — factures, montants réglés et restants, échéances, paiements et accès aux reçus ; possibilité de lancer un encaissement.
4. **Absences et suivi** — liste des absences liées aux groupes de l'année active ; ajout avec date, groupe, motif facultatif et indication « justifiée », ou suppression après confirmation.

**Parcours type :** créez l'élève, ouvrez sa fiche, complétez les informations utiles, inscrivez-le à un groupe et suivez ses factures ainsi que ses absences.

### C. 📚 Gestion des groupes

**But :** organiser l'offre pédagogique et définir les tarifs mensuels.

**Écrans principaux :** cartes des groupes, formulaire de création/modification et fiche de groupe. Les cartes affichent notamment enseignant, horaire, tarif et effectif ; la fiche donne accès aux inscrits et à un résumé financier.

**Fonctionnalités clés :** le formulaire simple demande le nom, la matière, le niveau, le tarif mensuel et permet d'assigner un enseignant. La matière, le niveau et l'enseignant peuvent être créés depuis les sélecteurs. L'année active est utilisée ; les horaires et salles sont configurés séparément dans **Emploi du temps**. La fiche permet aussi d'ajouter ou de retirer un élève. Retirer un élève conserve la facture du mois en cours.

**Parcours type :** choisissez **Nouveau groupe**, renseignez ses informations et enregistrez. Ajoutez ensuite ses créneaux dans l'emploi du temps et inscrivez les élèves depuis la fiche du groupe ou celle d'un élève.

### D. 🗓️ Emploi du temps

**But :** visualiser et gérer les cours de la semaine.

**Écran principal :** grille hebdomadaire filtrable par niveau, matière, enseignant et salle ; dimanche peut être affiché. Sur un écran étroit, la navigation se fait par jour.

**Fonctionnalités clés :** dans **Gérer les horaires**, choisissez un groupe et ajoutez ses créneaux : jour, heure de début, heure de fin et salle. Les blocs sont positionnés à la minute et leur hauteur reflète leur durée ; les cours simultanés sont répartis en colonnes (*lanes*). Les conflits de salle ou d'enseignant donnent lieu à un avertissement non bloquant. Un groupe sans horaire valide n'apparaît pas dans la grille.

**Parcours type :** ouvrez l'éditeur, sélectionnez le groupe, ajoutez un créneau et sa salle, vérifiez les avertissements, puis enregistrez. Un seul créneau par jour est autorisé pour un même groupe.

### E. 👨‍🏫 Gestion des enseignants

**But :** gérer les enseignants, leurs groupes et les paiements qui leur sont versés.

**Écrans principaux :** liste et fiche enseignant, avec onglets **Informations**, **Groupes** et **Paiements**. Une fiche peut contenir coordonnées, matières et notes ; le statut peut être modifié sans effacer l'historique.

**Fonctionnalités clés :** les paiements sont **manuels**, sans saisie d'activités ni calcul automatique d'heures ou de paie. Saisissez un montant positif, une date, un mode parmi espèces, virement ou chèque, et éventuellement une note. L'historique et les totaux sont liés à l'année active. Des règlements historiques dont l'année ne peut être identifiée restent visibles séparément et exclus des totaux annuels.

**Parcours type :** ajoutez l'enseignant, associez-le à un groupe, ouvrez sa fiche puis **Paiements → Enregistrer un paiement**. Vérifiez la date et le mode avant de sauvegarder.

### F. 💳 Gestion des paiements

**But :** suivre les sommes dues, encaisser les élèves et consulter l'historique.

**Écran principal :** trois onglets : **Encaissements**, **Règlements enseignants** et **Historique**. Dans Encaissements, choisissez une période et dépliez les sections **En retard**, **Proches** et **À jour**. La section En retard donne accès aux relances WhatsApp distinctes pour l'élève et le tuteur.

**Fonctionnalités clés :**

- Génération des factures mensuelles pour la période choisie, et préparation d'un ancien mois pour un élève depuis l'assistant d'encaissement.
- Encaissement guidé : choix ou création de l'élève, sélection des factures, montant, date et mode, puis confirmation. L'affectation se fait aux factures sélectionnées les plus anciennes d'abord ; les paiements partiels laissent un solde dû et le surplus éventuel est enregistré comme avance.
- Modes élèves : espèces, virement, chèque ou autre. La date du paiement ne peut pas être future.
- Aperçu, impression ou téléchargement PDF du reçu ; réouverture depuis l'historique ou la fiche élève.
- Après confirmation, la suppression d'un paiement supprime **toute la transaction**, ses affectations et son reçu ; les factures et totaux concernés sont recalculés. L'opération est définitive.

**Parcours type :** sélectionnez le mois, générez les factures si nécessaire, ouvrez **Encaisser un paiement**, choisissez les factures et confirmez. Pour un impayé, utilisez le contact WhatsApp approprié dans la section En retard.

### G. 🧾 Frais et dépenses

**But :** suivre les charges du centre par période et par catégorie.

**Écran principal :** liste des dépenses avec sélection du mois, résumé et répartition par catégorie. Les catégories sont configurables dans les paramètres.

**Fonctionnalités clés :** ajout, modification et mise à la corbeille d'une dépense ; saisie du libellé, du montant, de la catégorie, de la date et des notes éventuelles. Les dépenses participent au calcul du net et aux exports annuels.

**Parcours type :** choisissez la période, ajoutez par exemple un loyer ou une facture d'électricité, puis consultez le total et la répartition. Retirer une catégorie des paramètres ne supprime pas les dépenses déjà enregistrées.

### H. 🗑️ Corbeille

**But :** permettre la récupération avant suppression définitive et rendre visibles les éléments supprimés.

**Écran principal :** liste par type avec date de suppression, jours restants, indicateur de conservation et actions **Restaurer** ou **Supprimer définitivement** ; une action permet également de vider la corbeille visible.

**Parcours type :** vérifiez l'année active, ouvrez Corbeille, puis restaurez l'élément souhaité ou confirmez sa suppression définitive. Avant de vider la corbeille, lisez attentivement la confirmation : notamment, la suppression définitive d'un élève concerne ses données de toutes les années. Voir les règles de rétention [ci-dessus](#corbeille-et-sauvegardes).

### I. ⚙️ Paramètres

**But :** configurer le centre, les références et la protection des données.

**Écran principal :** sections dépliables regroupant :

- **Identité du centre** : nom, adresse, téléphone et logo PNG, JPG ou SVG de 2 Mo maximum, utilisés notamment sur les documents.
- **Année scolaire** : création, activation, suppression d'une année inactive et exports PDF/Excel annuels.
- **Niveaux et branches**, **matières** et **catégories de dépenses** : gestion des listes de référence.
- **Langue** : français ou arabe ; changement immédiat.
- **Impression** : ticket thermique **80 mm** ou **58 mm**, avec 80 mm par défaut.
- **Sécurité** : délai de verrouillage et changement de mot de passe.
- **Sauvegarde** : chemin et taille de la base, dernière sauvegarde, copie `.db`, instructions de restauration et remise à zéro.

Les **frais d'inscription** sont saisis dans le formulaire de l'élève, et non dans une section dédiée de cet écran. Ils s'appliquent à sa première inscription annuelle ; une modification ne réécrit pas les factures déjà créées. Une valeur de zéro ne crée pas de facture de frais.

**Parcours type :** ouvrez Paramètres, dépliez la section voulue, apportez les changements et enregistrez lorsque le bouton est proposé. Avant une remise à zéro, faites une sauvegarde : elle supprime définitivement les données opérationnelles de toutes les années, tout en conservant les paramètres, références et accès.

## ✨ Fonctionnalités spéciales

| Fonction | Fonctionnement et précautions |
| --- | --- |
| **WhatsApp** | Un numéro mobile marocain valide `06…`, `07…`, `+212…`, `212…` ou `00212…` est normalisé vers un lien `wa.me` au format international. Les relances comprennent un message prérempli ; l'utilisateur l'envoie dans WhatsApp. Un numéro absent ou invalide ne produit pas de lien. Internet et WhatsApp sont nécessaires ; les informations du message sont transmises à ce service externe. |
| **Reçus thermiques** | Formats 80 mm et 58 mm uniquement, au choix dans les paramètres ou l'aperçu. Le reçu peut être imprimé ou téléchargé en PDF ; vérifiez le format papier dans les réglages de l'imprimante. Les libellés du reçu sont générés en français et les caractères arabes des données peuvent ne pas s'afficher correctement dans le PDF. |
| **PDF et Excel** | Depuis **Paramètres → Année scolaire**, exportez un résumé annuel PDF (effectifs, encaissements, dépenses, paiements enseignants, net et ventilation par matière) ou un classeur Excel détaillé à six onglets : élèves, paiements, dépenses, professeurs, groupes et paiements professeurs. Les avances sans facture ne sont pas ventilées par matière. Il n'existe pas d'export mensuel dédié du tableau de bord. |
| **Tarif personnalisé** | Lors de l'inscription, définissez au besoin un tarif mensuel propre à l'élève et au groupe, par exemple pour une réduction fratrie. Le tarif standard du groupe reste inchangé pour les autres élèves. |
| **Absences** | Depuis la fiche élève, associez une absence à un groupe, une date, un motif facultatif et un statut justifié ou non. Il faut d'abord inscrire l'élève à un groupe de l'année active. |
| **Paiements rétroactifs** | Pour régulariser un ancien mois de l'année active, vérifiez la date de début d'inscription, puis utilisez **Mois à régulariser → Préparer ce mois** dans l'encaissement de l'élève. Sélectionnez la facture et saisissez la date réelle du paiement. |
| **Niveau différent** | Si le niveau de l'élève diffère de celui du groupe, un avertissement apparaît ; il ne bloque pas l'inscription. Vérifiez le choix avant de confirmer. |

> **Historiques anciens :** les paiements élèves sans année scolaire identifiable sont conservés mais exclus des totaux annuels ; leur présence bloque les exports financiers annuels. Les règlements enseignants historiques dont la période est ambiguë restent également séparés des totaux annuels. Vérifiez ces situations avant toute analyse ou suppression d'année.

## 👣 Parcours utilisateur type

Exemple fictif : un directeur souhaite inscrire Salma dans un groupe de mathématiques.

1. **Première année scolaire.** À la première ouverture, configurez le nom du centre et le mot de passe. Une année calculée d'après la date du PC existe déjà : vérifiez son libellé et ses dates. Si vous avez besoin d'une autre période, ouvrez **Paramètres → Année scolaire → Nouvelle année**, saisissez le libellé et les dates, créez-la, puis activez-la et confirmez le changement.
2. **Premier professeur.** Dans **Enseignants**, choisissez **Nouvel enseignant**, saisissez son nom et, si souhaité, ses coordonnées et matières, puis enregistrez.
3. **Premier groupe.** Dans **Groupes → Nouveau groupe**, saisissez par exemple « Maths collège », choisissez matière et niveau, fixez un tarif de 300 DH par mois et sélectionnez le professeur. Enregistrez. Dans **Emploi du temps → Gérer les horaires**, ajoutez ensuite le jour, les heures et la salle.
4. **Premier élève.** Dans **Élèves → Nouvel élève**, saisissez prénom et nom, niveau, téléphone de l'élève, nom et téléphone du tuteur et date d'inscription. Renseignez si nécessaire les frais d'inscription et les informations facultatives, puis enregistrez.
5. **Inscription avec réduction.** Ouvrez la fiche de Salma, onglet **Groupes et tarifs**, puis lancez l'inscription. Sélectionnez le groupe et sa date de début ; saisissez par exemple **250 DH** comme tarif mensuel personnalisé au lieu de 300 DH. Vérifiez les avertissements et le résumé, puis confirmez. Le mois de début est facturé en entier, sans prorata ; les frais d'inscription éventuels sont facturés à la première inscription annuelle.
6. **Encaissement et reçu.** Dans la fiche ou dans **Paiements → Encaisser un paiement**, sélectionnez Salma et les factures à régler. Indiquez le montant, la date réelle et le mode, vérifiez le récapitulatif, puis confirmez et ouvrez le reçu. Choisissez le format thermique adapté et imprimez ou téléchargez le PDF.
7. **Relance.** Si une facture reste impayée et devient en retard, ouvrez **Paiements → Encaissements → En retard**. Cliquez sur WhatsApp élève ou WhatsApp tuteur selon le destinataire, vérifiez le message prérempli et envoyez-le depuis WhatsApp.
8. **Fin de mois.** Sélectionnez le mois dans le **Tableau de bord** pour consulter revenus, recouvrement, dépenses, paiements enseignants et net. Pour conserver des données exportables, ouvrez **Paramètres → Année scolaire** et téléchargez le résumé PDF ou le détail Excel de l'année ; ces exports sont annuels, pas limités au mois affiché. Faites aussi une sauvegarde `.db`.

## 🔎 Conclusion et limites actuelles

### Points forts

- Gestion locale et hors ligne des opérations courantes, sans compte cloud requis pour la base métier.
- Interface bilingue FR/AR, parcours guidés et accès rapide aux fiches.
- Années scolaires, tarifs individuels, facturation, reçus thermiques et suivi des absences réunis dans une même application.
- Sauvegarde locale, corbeille et confirmations pour les opérations sensibles.

### Limites connues

- Pas de gestion multi-utilisateur ou de rôles : un seul accès administrateur local.
- Pas de synchronisation entre ordinateurs ni de sauvegarde cloud automatique ; la restauration de la base est manuelle.
- WhatsApp est externe et nécessite Internet ; aucun message n'est envoyé automatiquement par CentreManager.
- Pas de module de statistiques avancées ni d'export mensuel dédié ; les exports PDF et Excel décrits ici portent sur une année scolaire.
- Pas de mode sombre. Le PDF des reçus utilise des libellés français et peut mal afficher des données en caractères arabes.
- Paiements enseignants saisis manuellement : pas de suivi des activités ou des heures ni de calcul automatique de paie.
- Un seul créneau par jour et par groupe dans l'éditeur d'horaires.
- La corbeille n'est pas une protection contre toutes les suppressions : notamment, les élèves expirés sont supprimés avec leurs données de toutes les années.

### Pistes d'évolution

Selon les besoins du centre : statistiques et exports mensuels avancés, thème sombre, meilleure prise en charge de l'arabe dans les reçus PDF, restauration assistée et contrôlée, sauvegardes automatisées, gestion de plusieurs utilisateurs et enrichissement des horaires ou du suivi pédagogique. Ces propositions ne constituent pas des fonctionnalités déjà disponibles.

## 🛠️ Documentation technique

### Prérequis et commandes

Pour travailler sur le code : Node.js et npm, Rust stable et les dépendances système de Tauri 2. Sous Windows, prévoir les outils de build C++ et WebView2. `rusqlite` utilise SQLite embarqué via la fonctionnalité `bundled`.

```bash
npm ci                 # Installer les dépendances
npm run dev            # Interface de développement dans le navigateur, port 1420
npm run build          # Vérification TypeScript et bundle Vite de production
npm run check:i18n     # Contrôle des traductions
npm run tauri dev      # Application desktop en développement
npm run tauri build    # Construction de l'application desktop
```

La configuration Tauri du dépôt cible actuellement un paquet **NSIS pour Windows**. Les dépendances système et les étapes de compilation varient selon la plateforme.

### Organisation du dépôt

```text
src/
  components/          Composants d'interface et documents PDF
  pages/               Écrans de l'application
  services/            Appels Tauri et backend de développement navigateur
  stores/              État partagé et session
  i18n/                Traductions françaises et arabes
src-tauri/
  src/commands/        Commandes Rust et règles métier
  src/db/              Schéma, migrations et initialisation SQLite
  src/models/          Modèles échangés avec l'interface
  tauri.conf.json      Configuration Tauri et empaquetage
scripts/check-i18n.mjs Contrôle des traductions
```

En Tauri debug, la base locale conserve le chemin historique `test-data/centremanager-dev.db` ; le dossier est créé si nécessaire et la base est ignorée par Git. En production, le chemin est celui du répertoire de données de l'application et peut être consulté dans les paramètres. Les bases existantes sont conservées et migrées au démarrage.
