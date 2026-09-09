<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Lire en : [日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | **Français** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

> Cette page est la version courte. Le guide d'installation détaillé et le dépannage sont maintenus en [anglais](docs/setup.en.md) et en [japonais](docs/setup.md).

Un portail pour les statiques de FINAL FANTASY XIV : **planning, tableau de mitigation, butin, guides, vidéos et journaux d'entraînement** au même endroit.

Une application mono-locataire pensée pour « une équipe = un déploiement » — **vous la forkez pour votre propre statique**. La porte d'entrée est votre serveur Discord : seuls ses membres peuvent se connecter.

🔗 **Démo (lecture seule) : https://demo-raid-repository.vercel.app**
À parcourir librement. **Vous n'avez pas besoin de créer votre propre démo.**

---

## Fonctionnalités

### Planning

- **Trois modes** : **natif** (dates candidates, présences ○ × △ et confirmation entièrement dans le portail) / **synchronisé** (import depuis character-sheets) / **désactivé**
- La séance confirmée est mise en avant comme **prochaine session** (le jour même avec un compte à rebours « début dans N h M min »)
- En fixant des **jours réguliers**, les dates candidates ne sont créées que ces jours-là ; la boîte de dialogue permet aussi une **génération en lot par période × jours**. Les dates hors cadre reçoivent la mention « exceptionnel » / « juste cette fois »
- En plus de ○ × △, chacun peut indiquer **une heure d'arrivée en cas de retard ou de départ anticipé** (affichée `21:30〜` à côté du symbole)
- **Relance automatique** des personnes sans réponse, et **confirmation automatique** une fois tout le monde inscrit (optionnel)
- Les modèles de notification Discord acceptent `{discord_relative}` / `{discord_time}`, rendus dans le fuseau horaire de chaque lecteur
- **Notes par date** avec niveau d'importance. L'auteur et les administrateurs peuvent les modifier ; les anciennes notes sans auteur enregistré peuvent être supprimées par n'importe quel membre
- **Récapitulatif de présence** — confronte les réponses (○ × △) aux journaux d'entraînement réels sur 90 jours et liste les écarts. Fonctionne dans les deux modes

### Contenus (catégories)

- Un **statut** par contenu (pas commencé / en cours / réussi / en pause), tri par glisser-déposer, synchronisation instantanée via Realtime
- Chaque carte affiche une **sparkline de progression sur 8 semaines**
- **Libellé de difficulté** et **modèle de progression** (étages / phases) réglables par contenu — utilisable avant même l'annonce des noms d'un nouveau palier
- Image de fond possible, avec le choix de **la zone affichée**

### Onglets par contenu

| Onglet | Contenu |
|---|---|
| **Mitigation** | Votre feuille Google existante, intégrée. **Sur mobile, une vue en cartes en lecture seule**, filtrable sur « mon rôle » / « mes assignations » |
| **Butin** | La même intégration, plus la **checklist hebdomadaire** (réinitialisation mardi 17:00 JST) et le **BiS** (intégration XivGear). La matrice « qui veut quoi » se replie |
| **Guides** | Liste de liens (titre récupéré automatiquement, tags, lu/non lu). Les Google Docs/Sheets s'affichent en carte typée |
| **Vidéos** | Miniatures YouTube avec lecture au clic, liens vers FFLogs / XIVAnalysis |
| **Macros** | Copie en un clic des macros du jeu ; le même onglet héberge les **repères (waymarks)** et les **codes de partage de plans** |
| **Journaux** | voir ci-dessous |

### Journaux d'entraînement

Données FFLogs importées pull par pull.

- Total de pulls / jours d'entraînement / meilleure phase atteinte / clears, avec une barre de progression par jour
- Depuis n'importe quel pull, un clic mène **au moment correspondant** dans FFLogs, XIVAnalysis ou la vidéo
- **Causes de wipe** (le premier job tombé ← la capacité fatale) et sur quelle mécanique ça casse ; on voit aussi **ce qui s'est passé juste avant la mort**
- Les ultimes affichent le **temps passé par phase** et la première arrivée, les savages la **première clear par étage**
- Une journée est dessinée comme une **rangée de cases** (une case = un pull, `✓` pour une clear)
- Des **notes d'erreur** par pull peuvent être ajoutées après coup
- ⚠ **Le DPS individuel n'est ni stocké ni affiché.** Les morts s'arrêtent à « job + capacité », sans nom de joueur

### Votre page (`/me`)

Accessible par l'icône de personne dans l'en-tête. Elle n'affiche **que vos propres données** (même les administrateurs n'y voient pas les lignes des autres).

- Vos jobs (valeur par défaut plus surcharge par contenu) — c'est ce qui alimente les filtres du tableau de mitigation
- **BiS restant** et **parcours d'apprentissage** sous forme de barres
- Un accès au récapitulatif de présence

### Et aussi

- **Palette de commandes** (Ctrl+K) — recherche transversale des contenus, onglets et actions
- **Import Discord automatique** — avec les identifiants de salon enregistrés, une tâche quotidienne à 01:00 JST extrait les URL des 100 derniers messages vers le bon onglet (également déclenchable par un bouton)
- **Parcours d'apprentissage** — checklist ordonnée pour les nouveaux : vidéo → placements → macro → mitigation
- **Thèmes** — sept thèmes d'extension, chacun avec son fond
- **Une seule échelle de cinq couleurs partout** (`src/lib/perf-tone.ts`) — bon = emerald → lime → amber → orange → rose = mauvais. ⚠ **La couleur ne porte jamais le sens à elle seule** (un chiffre ou un symbole l'accompagne toujours)

---

## Technique

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase (Postgres + Realtime + RLS) · shadcn/ui + Base UI · Vercel (déploiement auto depuis `main`, Cron Jobs).

**Quatre couches de défense** : ① porte OAuth Discord dans le proxy ② visibilité par rôle sur chaque page ③ vérification admin dans chaque Server Action ④ RLS côté base. Les jetons FFLogs sont chiffrés en AES-256-GCM.

---

## Installation (résumé, 20–40 minutes)

**Vous ne collectez que cinq valeurs à la main.** Le détail écran par écran est dans le [guide anglais](docs/setup.en.md).

> ⚠ Au moment du fork, **changez le nom du dépôt** (par ex. `pandora-raid`). Avec le nom par défaut, votre fork est impossible à distinguer des autres.

### 1. Collecter cinq valeurs (dans le navigateur)

| # | Valeur | Où |
|---|---|---|
| 1–3 | **Project URL** / **anon** / **service_role** Supabase | Créer un projet sur [Supabase](https://supabase.com) → Settings → API |
| 4 | **Jeton du bot** Discord | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**activer SERVER MEMBERS INTENT**) |
| 5 | **ID du serveur** Discord | Discord (mode développeur) → clic droit sur le serveur |

Deux choses de plus dans le navigateur :

- Ajouter `https://<project ref>.supabase.co/auth/v1/callback` dans Discord **OAuth2 → Redirects**
- Activer **Authentication → Providers → Discord** dans Supabase et y coller le Client ID / Secret

### 2. Configuration et base de données (une commande)

```bash
npm install
npm run setup
```

Le script valide chaque valeur à la saisie, écrit `.env.local`, **génère** les valeurs qui n'ont besoin que d'être aléatoires, guide la **création des tables**, puis lance le diagnostic.

### 3. Déployer, puis enregistrer l'URL de retour

Une fois déployé sur Vercel, renseignez dans **Supabase → Authentication → URL Configuration** la Site URL et les Redirect URLs (`https://<votre domaine>/auth/callback` et `http://localhost:3000/auth/callback`). **Sans cette étape, la connexion ne revient pas sur le site.**

```bash
npm run doctor -- --url https://<votre domaine>
```

### En cas de problème

```bash
npm run doctor
```

Il appelle réellement les API pour vérifier : variables d'environnement, accès à Supabase, application du schéma, activation de la connexion Discord, validité du jeton et présence du bot sur le serveur, et si **SERVER MEMBERS INTENT** est bien actif — avec la correction à faire pour chaque `❌`.

---

## Développement local

```bash
npm install
npm run setup   # la première fois (crée .env.local)
npm run dev
```

## Licence

MIT
