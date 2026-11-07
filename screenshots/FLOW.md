# Parcours des captures — CentreManager

Captures réalisées en mode **développement navigateur**, à 1280 × 800, le 7 novembre 2026. Le backend Tauri/SQLite n'est pas utilisé. Les données sont fictives ; aucun nom, téléphone ou mot de passe ne doit être utilisé en production.

## Reproduire automatiquement

1. Installer les dépendances : `npm ci` puis `npx playwright install chromium` (sur Linux, installer aussi les dépendances système demandées par Playwright).
2. Dans un **premier terminal**, démarrer `npm run dev` et attendre l'écoute sur `http://localhost:1420`.
3. Dans un **second terminal**, lancer `node scripts/take-screenshots.mjs`.

Le script ne démarre pas l'application. Il ouvre un contexte Playwright neuf, y crée le jeu de données via le backend dev, se connecte avec le mot de passe fictif `admin123`, puis parcourt l'interface. Il ne touche pas au localStorage d'un navigateur existant ni à la base Tauri. Les PNG de ce dossier sont remplacés ; une capture échouée est supprimée et le script retourne un code non nul en indiquant les étapes manquantes. Les sélecteurs attendent les contenus concernés, puis chaque capture attend 1,5 seconde ; une attente réseau bornée précède ce délai. En cas de navigateur spécifique, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` permet de fournir son chemin. `SCREENSHOT_BASE_URL` change l'URL du serveur dev. `PLAYWRIGHT_NO_SANDBOX=1` n'est à utiliser que dans un environnement isolé qui le nécessite.

**Limite de la capture 20 fournie :** l'environnement de capture utilise Chromium headless shell sans lecteur PDF intégré. La fenêtre du reçu et ses commandes sont visibles, mais la zone du document est blanche ; ce PNG ne prouve donc pas le rendu du contenu PDF. Pour vérifier le reçu lui-même, refaire cette étape dans un navigateur doté d'un lecteur PDF, ou télécharger le PDF et l'ouvrir séparément. Les carrés à la place de certains emojis proviennent également des polices disponibles dans cet environnement.

## Jeu de données

- Centre Excellence Marrakech ; 2024-2025 inactive et 2025-2026 active ; frais d'inscription de 200 DH par élève à la première inscription de l'année.
- Salma El Mansouri, Youssef Benali, Fatima Zahra Idrissi, Amine Tazi et Hajar Fassi : chacun est inscrit dans un groupe. Salma et Youssef figurent également dans l'année précédente et apparaissent comme déjà importés dans la fenêtre d'import.
- Prof. Amrani, Prof. Bennani et Prof. Chraibi ; groupes Mathématiques / 2ème Bac, Physique-Chimie / 1ère Bac, Français / Tronc Commun et SVT / 3ème année collège. L'application affiche matière et niveau plutôt qu'un nom libre. Les groupes ont salles, horaires et tarifs.
- Factures mensuelles et frais d'inscription : un paiement mensuel complet, un partiel et des factures impayées. Les échéances impayées au 5 novembre sont en retard sur les captures du 7 novembre. Le parcours de capture du reçu réalise un paiement supplémentaire dans le contexte éphémère après les autres captures.
- Dépenses du mois courant : loyer 4 500 DH, électricité 520 DH et WiFi 300 DH ; anciennes fournitures dans la corbeille.

L'année active demandée est historique, tandis que les paiements et dépenses du mois courant suivent l'horloge réelle. Cette coexistence est volontaire pour couvrir les deux critères et ne représente pas une chronologie scolaire normale. Les montants, dates et catégories courantes peuvent donc varier lors d'une nouvelle exécution.

## Préremplissage et captures manuelles

Utiliser exclusivement une fenêtre/profil navigateur **vierge et jetable**, jamais un profil contenant des données à conserver. Démarrer Vite comme ci-dessus, ouvrir `http://localhost:1420`, puis dans la console du navigateur :

```js
await (await import('/scripts/screenshot-fixture.mjs')).seedScreenshots()
location.reload()
```

Si le store dev ou l'authentification existe déjà, la fonction refuse de les écraser. Dans un profil jetable **uniquement**, on peut confirmer l'écrasement avec `seedScreenshots({ overwrite: true })`. Après rechargement, se connecter avec `admin123`. L'état de connexion est en mémoire : après un rechargement, il faut se reconnecter. Le module refuse de s'exécuter en mode Tauri ou hors développement.

Régler le viewport à 1280 × 800, attendre la fin du chargement et encore 1–2 secondes, puis suivre ces chemins :

| Fichier | Navigation et état attendu |
| --- | --- |
| 01-login.png | Page de connexion avant authentification. |
| 02-dashboard.png | Tableau de bord, KPI, échéances et derniers paiements. |
| 03-students-list.png | Élèves : les cinq élèves actifs. |
| 04-student-detail.png | Élèves → Salma El Mansouri. |
| 05-student-modal-add.png | Élèves → Nouvel élève. |
| 06-groups-list.png | Groupes : les quatre cartes. |
| 07-group-modal-add.png | Groupes → Nouveau groupe. |
| 08-teachers-list.png | Enseignants : trois cartes. |
| 09-teacher-detail.png | Enseignants → Prof. Amrani. |
| 10-teacher-modal-add.png | Enseignants → Nouvel enseignant. |
| 11-payments.png | Paiements : sections en retard, proches et à jour. |
| 12-payment-modal.png | Paiements → Encaisser un paiement. |
| 13-expenses.png | Frais : dépenses et totaux du mois. |
| 14-expense-modal.png | Frais → Nouvelle dépense. |
| 15-timetable.png | Emploi du temps : créneaux des quatre groupes. |
| 16-settings.png | Paramètres : vue générale. |
| 17-settings-school-year.png | Paramètres → Année scolaire, faire défiler jusqu'aux deux années et au tarif. |
| 18-trash.png | Corbeille : anciennes fournitures. |
| 19-import-students.png | Élèves → Importer depuis l'année précédente : deux élèves déjà importés. |
| 20-receipt-pdf.png | Paiements → Encaisser → choisir Fatima Zahra Idrissi et des factures → Suivant → confirmer et imprimer ; attendre le rendu du PDF. |
| 21-sidebar-year-switch.png | Sélecteur d'année de la barre latérale → 2024-2025 ; capturer la confirmation sans valider. |

Vérification du seed sans navigateur : `node tests/screenshot-fixture.mjs`.

## Captures complémentaires des formulaires (22–43)

Pour ne régénérer que ces captures, avec le serveur déjà lancé dans un autre terminal :

```sh
node scripts/take-screenshots.mjs --modals-only
```

Sans cette option, le script capture l'ensemble du parcours 01–43. Les sections élève ne sont pas un assistant à étapes : elles se trouvent dans un seul formulaire défilant. Les formulaires de création sont partiellement remplis sans être enregistrés. Le nom « Salma El Mansouri » existant dans la fixture suffit à déclencher l'avertissement de doublon ; aucun deuxième élève n'est enregistré. Les confirmations de suppression et de vidage sont fermées sans validation.

| Fichier | Chemin / état |
| --- | --- |
| 22-modal-add-student-step1.png | Élèves → Nouvel élève ; identité avec Salma, El Mansouri et 2ème Bac. |
| 23-modal-add-student-step2.png | Même formulaire, section Parent / Tuteur. |
| 24-modal-add-student-step3.png | Même formulaire, section Administratif. |
| 25-modal-edit-student.png | Fiche Salma → Modifier, champs préremplis. |
| 26-modal-add-group.png | Groupes → Nouveau groupe, matière et niveau sélectionnés. |
| 27-modal-add-group-schedules.png | Même formulaire, jours et heures. |
| 28-modal-edit-group.png | Groupe Mathématiques → Modifier. |
| 29-modal-add-teacher.png | Enseignants → Nouvel enseignant, nom saisi. |
| 30-modal-edit-teacher.png | Fiche Prof. Amrani → Modifier. |
| 31-teacher-payment-history.png | Fiche enseignant → Paiements, historique de l’année active. |
| 32-modal-add-teacher-compensation.png | Fiche enseignant → Informations → Configuration de la compensation. |
| 33-modal-add-teacher-settlement.png | Fiche enseignant → Paiements → Enregistrer un paiement. |
| 34-modal-add-payment.png | Paiements → Encaisser → choisir un élève et des factures → étape montant et mode. |
| 35-modal-add-expense.png | Frais → Nouvelle dépense. |
| 36-modal-edit-expense.png | Frais → Modifier une dépense existante. |
| 37-modal-enroll-student.png | Fiche Salma → Inscriptions → Inscrire à un groupe. |
| 38-modal-import-students.png | Élèves → Importer depuis l'année précédente. |
| 39-modal-import-groups.png | Groupes → Importer depuis l'année précédente. |
| 40-modal-creatable-teacher.png | Nouveau groupe → Enseignant → saisir un nouveau nom → Créer ; formulaire enseignant complet imbriqué. |
| 41-modal-delete-confirm.png | Élèves → icône corbeille de Salma, sans confirmer. |
| 42-modal-trash-empty-confirm.png | Corbeille → Vider la corbeille, sans confirmer. |
| 43-modal-duplicate-warning.png | Nouvel élève → même nom et téléphone que Salma ; alerte de doublon visible. |

**Particularités de l'interface actuelle :** la compensation (32) est un formulaire intégré à la fiche, pas une modale ; le formulaire groupe n'a pas de champ de nom libre (son nom est composé à partir de la matière et du niveau) ; la période d'une dépense est choisie sur la page plutôt que dans sa modale. Pour illustrer un import de groupe non vide (39), le script ajoute un groupe historique fictif dans son contexte jetable, après les captures des pages principales. Le script enregistre aussi une estimation fictive avant d'ouvrir le paiement (33), mais ne valide aucun paiement.
