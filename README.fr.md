<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Lire en : [日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | **Français** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

> Cette page résume les fonctionnalités et l'installation. Le guide complet pas à pas (variables d'environnement, dépannage) est maintenu en [anglais](README.en.md) et en [japonais](README.md).

Un portail pour les statics de FINAL FANTASY XIV : planning, tableau de mitigation, gestion du loot, guides, vidéos et journal d'entraînement au même endroit.

Conçu sur le principe « un groupe = un déploiement » : une application mono-locataire que vous forkez et hébergez pour votre propre static.

## Démo

Site de démonstration public en lecture seule : 🔗 **https://demo-raid-repository.vercel.app**

## Fonctionnalités

### Planning
- Trois modes de source : **Synchronisé** (import depuis character-sheets), **Natif** (dates candidates, présence ○ × △ et confirmation dans le portail, avec liaison FFLogs et notifications Discord), **Désactivé**
- La session confirmée est mise en avant comme **prochaine session** (le jour même, avec un compte à rebours « commence dans N h M min »)
- En mode natif, chaque membre peut indiquer une **heure d'arrivée tardive / de départ anticipé** (HH:MM), affichée à côté du symbole (`21:30〜`) et à côté du nom dans la confirmation Discord
- Les modèles Discord acceptent `{discord_relative}` / `{discord_time}` (rendus dans le fuseau du lecteur, par ex. « dans 3 heures »)
- Rappel automatique par @mention aux membres sans réponse ; confirmation automatique optionnelle quand tout le monde a répondu
- Commentaire par membre au survol / à la pression ; lien Google Agenda par session

### Contenus (catégories)
- Par contenu de raid, un **statut** (Non commencé / En cours / Terminé / En pause), tri par glisser-déposer, dialogue d'édition, synchronisation temps réel via Supabase Realtime

### Sous-onglets par contenu
- **Mitigation / Loot** : vos Google Sheets existants en iframe ; **sur mobile, une vue en cartes en lecture seule** (feuille chargée en CSV, une carte par phase, filtre « ma colonne seulement »). L'onglet loot ajoute le **suivi hebdomadaire** (réinitialisation le mardi 17:00 JST) et les **liens BiS** (intégration XivGear)
- **Guides** : liste de liens avec titre automatique ; **Vidéos** : aperçu YouTube en lazy-embed, lien FFLogs / XIVAnalysis optionnel
- **Macros** : macros du jeu avec copie en un clic ; plus les **presets de waymarks** (markercode) et les **codes de partage du Strategy Board**
- **Journal d'entraînement** : données pull par pull importées de FFLogs — total de pulls, jours d'entraînement, progression maximale, clears ; barre de progression par jour ; depuis chaque pull, un clic vers FFLogs / XIVAnalysis / l'instant dans la vidéo ; **cause du wipe** par pull (job mort en premier ← compétence fatale, morts dans les 10 s) et comptage des mécaniques qui font tomber le groupe ; pour les Ultimates, **temps passé par phase**. Les DPS individuels ne sont ni stockés ni affichés ; les morts sont enregistrées sans nom de joueur (job + compétence seulement)

### Import automatique depuis Discord
- Par contenu, un canal « guides » et un canal « vidéos » ; Vercel Cron récupère chaque jour à 01:00 JST les 100 derniers messages, extrait les URL, dédoublonne et les range dans l'onglet correspondant. Import immédiat par bouton

### Thèmes et couleurs
- Sept thèmes d'extension (ARR à Evercold) avec leurs effets d'arrière-plan
- **Sémantique des couleurs en cinq niveaux** (`src/lib/perf-tone.ts`) : bon = emerald → lime → amber → orange → rose = mauvais, appliquée aux HP restants, aux morts, aux barres de progression, aux symboles de présence et au suivi hebdomadaire. Les chiffres et symboles sont toujours affichés à côté

## Technique

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase (Postgres + Realtime, RLS) · shadcn/ui + Base UI · Vercel (déploiement auto depuis `main`, Cron Jobs). Quatre couches de sécurité : porte OAuth Discord dans le proxy, restriction par rôle par page, contrôle admin dans chaque Server Action, RLS en base. Les jetons FFLogs sont chiffrés en AES-256-GCM.

## Installation (résumé, 30–60 minutes)

Il vous faut des comptes GitHub, Supabase (gratuit), Vercel (Hobby) et Discord Developer Portal.

1. **Forkez** ce dépôt — changez impérativement le nom du dépôt (par ex. `pandora-raid`)
2. **Projet Supabase** : exécutez `supabase/schema.sql` dans le SQL Editor, notez Project URL / anon key / service_role key
3. **Application + Bot Discord** : Client ID / Client Secret, Bot Token (avec SERVER MEMBERS INTENT et MESSAGE CONTENT INTENT), ID du serveur (Guild ID)
4. **Liaison Discord ↔ Supabase** : redirect `https://<projet>.supabase.co/auth/v1/callback` côté Discord, fournisseur Discord activé dans Supabase avec Client ID / Secret
5. **Déploiement Vercel** avec les variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` (optionnel : `DISCORD_ADMIN_ROLE_IDS`, `CRON_SECRET`, `FFLOGS_API_KEY`, OAuth FFLogs, `SECRET_ENCRYPTION_KEY`, `YOUTUBE_API_KEY`)
6. **Invitez le bot** (scope `bot`, permissions « View Channels » et « Read Message History »)
7. **Supabase URL Configuration** : Site URL = domaine Vercel, Redirect URLs `https://<domaine>/auth/callback` et `http://localhost:3000/auth/callback`
8. **Première configuration** dans le portail : source du planning, contenus, URL des feuilles
9. *(Optionnel)* ID des canaux pour l'import Discord et droits de lecture du bot par canal
10. *(Optionnel)* secret GitHub `SUPABASE_DB_URL` (Session pooler) pour déployer `schema.sql` automatiquement via GitHub Actions

Détails de chaque étape, dépannage et mises à jour du schéma : [guide anglais](README.en.md#setup-for-your-raid-group).

## Développement local

```bash
npm install
cp .env.local.example .env.local  # renseigner les clés Supabase
npm run dev
```

## Licence

MIT
