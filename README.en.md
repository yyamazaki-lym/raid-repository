<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Read in: [日本語](README.md) | **English** | [Deutsch](README.de.md) | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

A portal for FINAL FANTASY XIV raid statics: schedule, mitigation sheet, loot tracking, strategy links, videos and practice logs in one place.

Built on a "one group = one deployment" premise: a single-tenant app you fork and run for your own static.

## Live demo

A public, read-only mock site to try the experience:

🔗 **https://demo-raid-repository.vercel.app**

Sample data is seeded (7 contents, 8 weeks of schedule history, mitigation / loot sheets, strategy links, videos, macros, recruitment templates; from `supabase/seed-demo.sql`, applied to the demo project only). `PUBLIC_DEMO_MODE=true` skips the Discord OAuth gate while every write is rejected by the admin gate, so the site stays view-only behind a 4-layer defense (proxy / page / Server Action / RLS).

## Deploy

One click forks the repository into your GitHub and deploys it to your Vercel (you need a Supabase project and a Discord Bot first; see [Setup for your raid group](#setup-for-your-raid-group)):

> ## ⚠️ Before you deploy
>
> On the screen after the Deploy / Fork button, **change the default project / repository name `my-raid-repository`**.
>
> - Keeping the default gives your fork the same name as every other static using this repository, and you will not be able to tell them apart in the Vercel dashboard or by URL
> - Pick a name that identifies your static (e.g. `pandora-raid`, `phoenix-fixed-portal`, `tuesday-night-raid`)
> - **It applies to both the GitHub repo name and the Vercel project name** (changing only one is not enough)
> - Renaming later is possible, but URLs and OAuth callbacks then have to be realigned, so **deciding at the start is easier**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yyamazaki-lym/raid-repository&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,DISCORD_BOT_TOKEN,DISCORD_GUILD_ID&envDescription=Supabase%20%2B%20Discord%20OAuth%20%E5%BF%85%E9%A0%88%20%28%E8%A9%B3%E7%B4%B0%20%3A%20envLink%29&envLink=https://github.com/yyamazaki-lym/raid-repository/blob/main/.env.local.example&project-name=my-raid-repository&repository-name=my-raid-repository)

Optional variables (DISCORD_ADMIN_ROLE_IDS / YOUTUBE_API_KEY / FFLOGS_API_KEY / FFLogs OAuth / SECRET_ENCRYPTION_KEY / CRON_SECRET) can be added after deployment from the Vercel dashboard → Settings → Environment Variables.

## What it does

### Schedule
- Pick the source mode in the settings dialog: **Sync** (imports from character-sheets, the default) / **Native** (add candidate dates, enter attendance and confirm sessions inside the portal, with FFLogs linkage and Discord notifications) / **Off**
- The "confirmed" (`DECISION`) row is highlighted as the **next session** (on the day itself, with a "starts in N h M min" countdown)
- In native mode, besides ○ × △, members can enter their own **late arrival / early leave time** (HH:MM). It shows next to the symbol as `21:30〜` and next to the name in the Discord confirmation post
- Discord notification templates (session confirmation / attendance reminder) accept `{discord_relative}` / `{discord_time}`, rendered in the reader's time zone as "in 3 hours" / "Tue, Sep 8, 21:00"
- Hover (PC) / tap (mobile) a member name to see their one-line comment
- Past sessions toggle (hidden by default)
- Sync mode imports the schedule list from character-sheets.appspot.com; clicking a name jumps to that member's input page on character-sheets
- The schedule URL is **shared by everyone through the Supabase `app_settings` table** (one member registers it, everyone gets it on reload)

### Contents (categories)
- Per raid content, a **status** (Not started / In progress / Cleared / On hold)
- Drag to reorder (mouse, long-press touch, keyboard)
- Edit dialog for name / URL slug / status / sheet URLs / Discord channel IDs
- Delete confirmation dialog
- Instant sync to every member through Supabase Realtime

### Sub tabs (per content)
- **Mitigation / Loot**: your existing Google Sheets embedded full width in an iframe (80% scale)
  - **Mobile gets a read-only card view** (the sheet is fetched as CSV and rebuilt as per-phase cards, with a "only my column" filter). Falls back to the iframe when the sheet cannot be fetched
  - The loot tab adds a **weekly clear check** (reset Tuesday 17:00 JST, badge with the number of members still pending) and **best-in-slot (BiS) links** (share URLs from XivGear etc., tagged with job / owner)
- **Strategy**: list of wiki / article links, drag-and-drop ordering, title fetched from the URL
- **Videos**: YouTube shows a thumbnail with click-to-play (lazy embed); other video sites show as link cards
  - Optionally attach an FFLogs URL (one tap to the report / to the **XIVAnalysis** analysis page)
- **Macros**: in-game macros stored as label + body, one-tap copy, drag-and-drop ordering
  - The same tab has a **waymark (markercode)** section: placement strings exported by EchoPlan and similar tools, stored with a label and note, one-tap copy
- **Practice log**: pull-by-pull data imported from FFLogs
  - Summary of total pulls / practice days / deepest reach / clears, plus a per-day **progress bar** (bar = best reach that day, right edge = kill, flag on personal-best days)
  - Phase labels (P1…) are shown **only for Ultimates** (Savage shows remaining HP%). Trash fights are dropped at import
  - Open a day to see its pulls; from each pull, one click to **the fight on FFLogs / the XIVAnalysis analysis / that moment in the video**
  - The video jump works for every pull once you register, per report, "how many seconds into the video the report starts"
  - Each pull shows the **wipe cause** (abbreviated job that died first ← killing-blow ability, number of deaths within 10 s). Per day and per content, the abilities that break the party are counted
  - Ultimates get **time per phase** (a phase band bar per pull and the share over all pulls)
  - Individual DPS is neither aggregated nor displayed (party-level progress only). Deaths are stored without player names, down to job + ability

### Discord auto-import
- Per content, a "strategy channel ID" and a "video channel ID"
- Vercel Cron pulls the latest 100 messages of each channel **daily at 01:00 JST**
- URL extraction + de-duplication + page title fetch → inserted into the matching sub tab
- Per-content **pause** toggle
- The **"Discord import"** button on the contents list runs it **immediately** (shows `+N / duplicates / failed / scanned 0` per content)
- Imported links carry a **fingerprint icon** so they can be told apart from manual entries
- Content cards show a **7-day import count badge** (`+N/wk`)

### Themes
Seven FFXIV expansion themes, each with its own background effect:

| Theme | Effect |
|---|---|
| A Realm Reborn | Faint distant meteors and fine stardust |
| Heavensward | Stained-glass lattice with golden light shafts |
| Stormblood | Desert strata with drifting sand |
| Shadowbringers | Sin eater light falling into the void, floating aether motes |
| Endwalker | Lunar ring, stars and an aurora band |
| Dawntrail | Sun disc with rays from below |
| Evercold | Two layers of snowfall (small / fast and large / slow) |

### Color semantics (5-step scale)

Colors meaning "good / caution / bad" follow one scale everywhere (`src/lib/perf-tone.ts`): **good = emerald → lime → amber → orange → rose = bad**. Remaining HP% in the practice log (kill = good), death counts, progress bars, attendance symbols (○ / ⏰ / △ / ×), the weekly clear check (cleared / passed / N pending) and BiS slot completeness share the same meaning. Numbers and symbols are always shown alongside, so color alone never carries the meaning. Floor / phase identity colors (sky → teal → violet …) tell "which one", not good or bad, and are a separate system.

## Tech

- Next.js 16 + React 19 + Tailwind CSS v4
- Supabase (Postgres + Realtime; RLS opens SELECT, writes are limited to the admin role behind a Discord OAuth gate)
- shadcn/ui + Base UI primitives
- @dnd-kit (drag-and-drop ordering)
- motion (tab animation)
- Vercel auto-deploy from GitHub `main`
- Vercel Cron Jobs (Discord import / FFLogs sync)

### Security layers

Four layers of defense since 2.1:

1. **proxy.ts**: Discord OAuth gate — non-guild members are redirected to `/login` / `/auth/denied`
2. **Per page**: `categories.required_role_ids` restricts individual categories to roles
3. **Server Action entry**: `assertAdminResult()` limits every mutation (categories CRUD / app_settings / FFLogs / video metadata) to the admin role
4. **Database (RLS)**: INSERT/UPDATE/DELETE require `auth.jwt()->'app_metadata'->>'is_admin' = 'true'`; SELECT is open to anon + authenticated (public read is preserved)

Also: CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy headers, rate limits on `/auth/callback` and `/api/cron/*`, FFLogs tokens stored AES-256-GCM encrypted (`secrets` table), generic DB error messages from Server Actions (no raw Postgres errors leak).

> 📌 **Self-hosting outside Vercel (rate limit)**: the rate limiter prefers the `x-real-ip` header to identify the client. Vercel always sets it to the real client IP, so the standard setup (Vercel + any DNS CNAME / custom domain) is safe. Only when you self-host behind a reverse proxy that does not set `x-real-ip` (your own nginx etc.), **make that proxy set `x-real-ip` to the real client IP** — otherwise an attacker can spoof `x-forwarded-for` on every request and bypass the limit.

## Setup for your raid group

> 📌 **Revised 2026-05**: steps are ordered so that Discord authentication comes first. `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` and the Discord Application's Client ID / Secret are needed before the Vercel deploy, so steps 3 / 4 collect and configure them together.

How to run this repository for your own static. Allow 30–60 minutes (plus an optional 10 minutes for per-channel Discord import settings).

### What you need

| Required | Account / tool | Purpose |
|---|---|---|
| ✅ | [GitHub](https://github.com) | Repository hosting (free) |
| ✅ | [Supabase](https://supabase.com) | DB + Realtime (free tier is enough) |
| ✅ | [Vercel](https://vercel.com) | Hosting (Hobby tier is enough) |
| ✅ | [Discord Developer](https://discord.com/developers/applications) | OAuth gate (guild membership check) + auto-import |

For local development you also need **Node.js 20+** and **npm**.

---

### 1. Fork (1 min)

> ⚠️ **Do not fork with the default name**
> If you just click through, your repo gets the exact same name `raid-repository` as every other static's fork, and you cannot tell them apart in your own Vercel dashboard. **Change the name** in step 3 below.

1. Click **Fork** at the top right of this repository
2. Select your account
3. **Change the Repository name** from the default (`raid-repository`) to something that identifies your static (e.g. `pandora-raid`, `phoenix-fixed-portal`, `tuesday-night-raid`). It also becomes the default project name when importing into Vercel
4. **Create fork**

---

### 2. Create the Supabase project (5 min)

#### 2-1. Create the project

1. Log in at https://supabase.com (GitHub login recommended)
2. Click **New project**
3. Fill in:
   | Field | Recommended |
   |---|---|
   | Name | anything, e.g. `raid-repository` |
   | Database Password | auto-generate → copy and keep it (rarely needed) |
   | Region | the one closest to your members (e.g. **Northeast Asia (Tokyo)** for JP) |
   | Pricing Plan | **Free** |
4. **Create new project** → wait a few dozen seconds

#### 2-2. Run the schema

1. Left menu **SQL Editor** → **New query**
2. Copy the **entire** [`supabase/schema.sql`](./supabase/schema.sql) from this repository and paste it
   - Opening GitHub's **Raw** view and using Ctrl+A → Ctrl+C is the safest way
3. **Run** at the bottom right (or Ctrl+Enter)
4. Done when you see "Success. No rows returned"
5. (Check) In **Table Editor** you should see tables such as `categories`, `category_links`, `app_settings`

> 📌 **Production / real static**: running schema.sql is all you need. `/category` starts empty; register your contents with "+ Add content".
>
> 📌 **Demo / mock site only**: additionally run [`supabase/seed-demo.sql`](./supabase/seed-demo.sql) in the SQL Editor to insert 7 sample categories with sample data (videos / mitigation / loot / recruitment templates). **Never run it in production** — it mixes demo data into your real tables. It is idempotent (ON CONFLICT / sentinel / URL NOT EXISTS guards), so re-running it on a demo project is safe.
>
> 📌 **Automatic schema deploy with GitHub Actions (optional)**: a workflow is included that runs the SQL Editor step for you on every main push that touches `supabase/schema.sql`. Register the Supabase connection string as a repo secret and manual copy-paste is no longer needed. See **[10. (Optional) Automatic schema deploy with GitHub Actions](#10-optional-automatic-schema-deploy-with-github-actions-5-min)**.

#### 2-3. Collect the credentials

1. Left menu **Settings** (gear) → **API**
2. Copy these **three values** (used in step 5):
   | Item | Where |
   |---|---|
   | **Project URL** | the Project URL field (`https://xxxxx.supabase.co`) |
   | **anon public** key | Project API keys → the long string in the `anon` `public` row |
   | **service_role** key | same table → the `service_role` row |

> ⚠️ The `service_role` key must **never reach the browser** (it bypasses RLS). Register it only as a server-only Environment Variable on Vercel, never with a `NEXT_PUBLIC_` prefix. The server-side `/auth/callback` needs it to write the Discord membership check into `app_metadata`.

> 💡 Note the subdomain part of the **Project URL** (the `xxxxx` in `xxxxx.supabase.co`); you need it for the Redirect URI you register in the Discord Developer Portal in step 4.

---

### 3. Create the Discord Application + Bot (10 min, required)

Discord guild membership is the portal's **OAuth gate**, so this step is required even if you never use the bot import feature. The Application (OAuth) and the Bot are created as one app on the same screen.

#### 3-1. Create the Application

1. Log in at https://discord.com/developers/applications
2. **New Application** at the top right → name (e.g. `Raid Repository`) → **Create**
3. Adjust the name / icon under **General Information** if you like

#### 3-2. Get the OAuth2 Client ID / Client Secret

1. Left menu **OAuth2** → the **OAuth2** page
2. Copy the **CLIENT ID**
3. Press **Reset Secret** in the **CLIENT SECRET** field and copy the secret shown
   - It is shown only once, so write it down. If you lose it, reset again on the same screen

> ⚠️ The Client Secret is **pasted only into Supabase's Authentication provider settings**. It is not registered in Vercel Environment Variables or `.env.local`.

#### 3-3. Enable the Bot, turn on the intents, get the token

1. Left menu **Bot**
2. Scroll to **Privileged Gateway Intents**:
   - **SERVER MEMBERS INTENT** → **ON** (required for the guild membership check of the OAuth gate)
   - **MESSAGE CONTENT INTENT** → **ON** (required for the auto-import to read message bodies)
   - Leave the rest OFF
   - **Save Changes** at the bottom
3. In the **Token** section of the same Bot page → **Reset Token** → **copy the token** (shown only once; used as `DISCORD_BOT_TOKEN` in step 5)

#### 3-4. Get the Discord server ID (Guild ID)

1. In the Discord app, turn on **Settings → Advanced → Developer Mode**
2. **Right-click your server icon → Copy Server ID** in the left sidebar
3. Note it (used as `DISCORD_GUILD_ID` in step 5)

> 💡 Make sure you now have all four: Client ID / Client Secret / Bot Token / Guild ID.

---

### 4. Connect Discord ↔ Supabase OAuth (5 min, required)

Using the values from steps 2 and 3, link the Discord Developer Portal and the Supabase dashboard in both directions. **Finishing this before the Vercel deploy lets you test login right after deploying** (the Vercel domain side of URL Configuration is added in step 7).

#### 4-1. Discord Developer Portal → OAuth2 → Redirects

1. Open the **OAuth2** page of the Application from step 3
2. In **Redirects**, **Add Redirect** and paste:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```
   - `YOUR_PROJECT_REF` is the subdomain of the Supabase Project URL from step 2-3
   - This is Supabase's fixed callback URL, so the Discord side never changes even if your Vercel domain does
3. **Save Changes**

#### 4-2. Supabase Dashboard → Authentication → Providers

1. Open the project at https://supabase.com/dashboard
2. Left menu **Authentication → Providers**
3. Expand **Discord** → turn on **Enable Discord provider**
4. Paste the Client ID from step 3-2 into **Client ID**
5. Paste the Client Secret from step 3-2 into **Client Secret**
6. **Save**

> 📌 Site URL / Redirect URLs (the Vercel domain side) are configured in step 7 once the Vercel domain exists. Leave them empty for now.

---

### 5. Deploy on Vercel (5 min)

#### 5-1. Import the project

1. Log in with GitHub at https://vercel.com/login
2. Open https://vercel.com/new
3. Find your fork under **Import Git Repository**
   - The first time, use **Adjust GitHub App Permissions** so the fork is included
4. Click **Import**
5. On **Configure Project**:
   - Framework Preset: **Next.js** (auto-detected)
   - Scroll down

#### 5-2. Environment variables

Expand **Environment Variables** and register the following (`.env.local.example` describes required vs optional in detail; check Production / Preview / Development for all of them).

#### Required

| Name | Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 2-3 | DB connection |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key from step 2-3 | DB connection (read-only in effect; writes are admin-only through RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from step 2-3 | Writes `app_metadata` in the OAuth callback + the encrypted secrets table (⚠️ NEVER expose to the browser) |
| `DISCORD_BOT_TOKEN` | Bot token from step 3-3 | Guild membership check of the OAuth gate + auto-import |
| `DISCORD_GUILD_ID` | Discord server ID from step 3-4 | The guild checked by the OAuth gate |

**Never** add the `NEXT_PUBLIC_` prefix to server-only variables such as `SUPABASE_SERVICE_ROLE_KEY`; they would be bundled into the browser and leak.

#### Recommended / optional

| Name | Value | Purpose |
|---|---|---|
| `DISCORD_ADMIN_ROLE_IDS` | comma-separated Discord role IDs | Restricts category editing etc. to holders of these roles (unset = everyone is admin, backward compatible) |
| `CRON_SECRET` | random string of 32+ characters | Vercel Cron authentication (required if you use auto-import) |
| `NEXT_PUBLIC_SPLASH_SW` | `true` | Enables the Service Worker (`public/sw.js`) that replaces the blank screen during cold start with a "starting" splash. Production only. Unset / false = not registered and any registered SW is removed (kill switch). Inlined at build time, so changing it needs a redeploy |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | Duration / upload date of unlisted videos (without it, an HTML scrape fallback is used, which Vercel IPs sometimes fail as bots) |
| `SECRET_ENCRYPTION_KEY` | 64 hex characters (`openssl rand -hex 32`) | AES-256-GCM encryption of FFLogs tokens etc. (without it, the legacy plain-text `app_settings` storage is used) |
| `FFLOGS_API_KEY` | FFLogs API v1 key | Automatic report ↔ video matching (public reports) + fetching **unlisted reports** for the practice log (by code, the same route xivanalysis uses) |
| `FFLOGS_OAUTH_CLIENT_ID` | FFLogs OAuth Client ID | Automatic matching of **private / unlisted** reports (Authorization Code Flow). Optional if v1 is enough |
| `FFLOGS_OAUTH_CLIENT_SECRET` | FFLogs OAuth Client Secret | Same as above (server-only). Details in `.env.local.example` |

Generating `CRON_SECRET` (PowerShell):
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

or Bash:
```bash
openssl rand -hex 16
```

#### 5-3. Deploy

1. Click **Deploy**
2. Wait 1–2 minutes (the build log streams live)
3. When done, you get a `https://your-project-name.vercel.app` URL — copy it, step 7 needs it

#### 5-4. (Optional) Custom domain

To use your own domain such as `raid.example.com`, add it under **Settings → Domains** and point a CNAME at Vercel in your DNS (Cloudflare etc.). Using the custom domain as the Site URL in step 7 keeps things tidy.

---

### 6. Invite the Bot to your Discord server (3 min)

Add the Application from step 3 to your static's server as a bot. Membership checks may pass even without it, but **calling the guild member API through `SERVER MEMBERS INTENT` requires the bot to be a member of that guild**, so do not skip this step.

1. Left menu **OAuth2 → URL Generator** of the Application from step 3
2. **Scopes**: check `bot`
3. **Bot Permissions**:
   - `View Channels`
   - `Read Message History`
4. Open the **GENERATED URL** at the bottom in a new tab
5. Choose your Discord server → **Authorize**

> 💡 For per-channel permission overrides used by the auto-import, see step 9.

---

### 7. Update Supabase URL Configuration after deploying (3 min, required)

Now that the Vercel domain exists (step 5), register it in Supabase Auth. **Skipping this causes a `redirect_uri_mismatch` error on the way back from Discord OAuth login.**

1. Vercel dashboard → your project → **Settings → Domains** to confirm the production URL (e.g. `your-project-name.vercel.app`)
2. Open the project at https://supabase.com/dashboard
3. Left menu **Authentication → URL Configuration**
4. Set **Site URL** to the Vercel domain:
   ```
   https://<your-vercel-domain>
   ```
5. Add these two to **Redirect URLs**:
   ```
   https://<your-vercel-domain>/auth/callback
   http://localhost:3000/auth/callback
   ```
   - Adding the wildcard form (`https://<your-vercel-domain>/**`) as well also covers preview deploy return URLs
6. **Save**

> 📌 If you later rename to a custom domain or a different Vercel project name, see [`.claude/todos/20.md`](./.claude/todos/20.md) (Site URL / Redirect URLs / FFLogs OAuth must be updated together).

#### 7-1. Verify login

1. Open `https://<your-vercel-domain>/` → you are redirected to `/login`
2. Press **Log in with Discord** → Discord's consent screen → landing on the portal top page means success
3. If you do not land there, check:
   - Site URL is the **new domain** (not still `raid-repository.vercel.app` or similar)
   - Redirect URLs contain `https://<your-vercel-domain>/auth/callback` as an exact match
   - Discord Developer Portal Redirects contain `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as an exact match
   - `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` are set on Vercel (step 5-2)
   - The bot actually joined the guild in step 6

---

### 8. Initial configuration (5 min)

Open the deployed URL. Nothing is registered yet.

#### 8-1. Register the schedule URL

1. Click the **⚙️ settings** icon at the top right of the header
2. Enter the character-sheets URL in the **Schedule Source** section
   - Format: `https://character-sheets.appspot.com/schedule/list?key=...`
   - If you have no character-sheets schedule yet, create one at https://character-sheets.appspot.com/schedule/ first
3. **Save**
4. Back on the home page you should see the next session and the schedule list

> The URL is stored in the Supabase `app_settings` table and **shared by all members**. One person registers it, everyone gets it.

#### 8-2. Add and edit contents

1. Open the **Contents** tab at the top
2. It starts empty; register your contents with **+ Add content** at the top right (edit / delete later from the **⋮** menu on each card)
3. Fields of the edit dialog:
   | Field | Description |
   |---|---|
   | Name | display name (e.g. Anabaseios) |
   | URL slug | alphanumerics and hyphens used in the path (e.g. `anabaseios`) |
   | Description | extra text on the card (optional) |
   | Status | Not started / In progress / Cleared / On hold |
   | Mitigation sheet URL | Google Sheets embed URL (optional) |
   | Loot sheet URL | same (optional) |
   | Discord channel IDs | see below (optional) |
4. **Save**

#### 8-3. Getting a Google Sheets URL

These URL forms work for the mitigation / loot sheets:

| Kind | Format | How to get it |
|---|---|---|
| Published URL | `.../pubhtml` | Sheets → **File → Share → Publish to web** |
| Embed URL | `.../e/.../pubhtml?widget=true` | same, when publishing to web |
| Regular share URL | `.../edit#...` | only when sharing is "Anyone with the link can view" |

#### 8-4. Check

- The schedule shows on the home page
- Clicking a content card shows the **Mitigation / Loot / Strategy / Videos / Macros** tabs
- **+ Add** in the Strategy and Videos tabs lets you register links

---

### 9. (Optional) Per-channel settings for Discord auto-import (10 min)

Once a day, URLs are fetched from the configured Discord channels and inserted into the Strategy / Videos tabs. The bot itself was created and invited in steps 3 / 6, so here you only (a) give the bot read access per channel and (b) register channel IDs per content.

> 📌 If `CRON_SECRET` was not set in step 5, add it now in Vercel dashboard → Settings → Environment Variables and **Deployments → ⋯ on the latest row → Redeploy** (environment variables apply on rebuild only).

#### 9-1. Per-channel permission override

Server-wide bot permissions and per-channel overrides are separate. For **each channel to import**:

1. Right-click the channel in Discord → **Edit Channel**
2. Left menu **Permissions**
3. **Add members or roles** → search the bot name → add
4. Allow (green check):
   - **View Channel**
   - **Read Message History**
5. **Save Changes**

> 💡 If every content has a strategy and a video channel, a dedicated bot role granted once may be easier.

#### 9-2. Copy channel IDs into the portal

1. Discord settings → **Advanced** → **Developer Mode** ON (skip if done in step 3-4)
2. **Right-click the channel → Copy Channel ID**
3. Paste into "Discord strategy channel ID" / "Discord video channel ID" in the content edit dialog
4. **Save**

#### 9-3. Check

Press **Discord import** on the `/category` page; the result appears under the button:

- ✅ `+N imported (...)` → success
- ℹ️ `No URLs found in Discord messages` → empty channel or missing bot permission (recheck 9-1)
- ⚠️ `failed N` → DB error etc. (see Vercel logs)
- ❌ `error: discord 401/403/...` → bot token or permission problem

Once it works, it runs automatically at 01:00 JST every day (cron schedule in `vercel.json`). You can run it manually from `/category` any time.

---

### 10. (Optional) Automatic schema deploy with GitHub Actions (5 min)

When `supabase/schema.sql` changes (after `git pull` from upstream → `git push`, or your own edits), you can **apply it with a single push** instead of pasting into the Supabase dashboard.

**What if I skip this?**
- Manual operation keeps working exactly as in step 2-2
- But every upstream schema change means re-running it in the SQL Editor

#### 10-1. Get the connection string

1. Supabase dashboard → **Settings → Database → Connection string**
2. Select the **Session pooler** tab (for CI, `postgres.<ref>` user)
   - "Direct connection" is IPv6-only on the Free plan and unreachable from GitHub Actions runners. **Always pick Session pooler**
3. Copy the URI (`postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-...:5432/postgres`)
4. Replace `[YOUR-PASSWORD]` with the DB password from step 2-1

#### 10-2. Register a GitHub repo secret

1. Your fork on GitHub → **Settings → Secrets and variables → Actions** → **New repository secret**
2. Enter:
   | Field | Value |
   |---|---|
   | Name | `SUPABASE_DB_URL` |
   | Value | the full URI from 10-1 |
3. **Add secret**

#### 10-3. Check

- That is all. The next main push touching `supabase/schema.sql` runs the "Deploy Database (Production)" workflow in the **Actions** tab and applies the schema
- (Optional) Actions tab → "Deploy Database (Production)" → **Run workflow** at the top right triggers it manually
- If the workflow fails, the psql error message is in the log. `schema.sql` is idempotent, so re-running is safe

> 📌 **Forks without the secret**: the workflow logs `Skipping: SUPABASE_DB_URL not set on this fork.` and exits successfully, so the Actions tab stays green. Ignore it if you prefer manual operation.

> 📌 **Demo project workflow** (`deploy-database-demo.yml`): a demo-only workflow that runs only in the upstream repository (`yyamazaki-lym/raid-repository`) is also included. It is irrelevant to forks (always skipped without the secret). Never register a `SUPABASE_DB_URL_DEMO` secret on a production fork, or seed-demo.sql would be applied to your production project.

---

### When the schema changes

If a future `git pull` of this repository extends the schema:

1. Re-run the new `supabase/schema.sql` from the pulled code in the Supabase SQL Editor
   - **If step 10 is set up, `git push origin main` is enough** — GitHub Actions applies it, no SQL Editor needed
2. Every `CREATE TABLE` / `ALTER TABLE` is written with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so it is **idempotent**
3. Existing data is not destroyed

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Could not connect to Supabase" after deploy | env vars missing → check Vercel Settings |
| `redirect_uri_mismatch` on login | check that the new domain's `/auth/callback` is in Redirect URLs (step 7) as an exact match |
| Redirected to `/auth/denied` right after login | (1) bot not in the guild (step 6) / (2) `SERVER MEMBERS INTENT` off (step 3-3) / (3) wrong `DISCORD_GUILD_ID` (step 5-2) |
| Cannot save the URL in the settings dialog | `app_settings` table missing → re-run schema.sql |
| Error when adding a content | RLS policies missing → re-run schema.sql |
| Discord import button says `not configured` | `CRON_SECRET` or `DISCORD_BOT_TOKEN` missing |
| Only `scanned 0` | the bot cannot see the channel → recheck step 9-1 |
| Members see the onboarding screen on home | schedule URL not saved → press **Save** in the settings dialog |

## Local development

```bash
npm install
cp .env.local.example .env.local  # fill in the Supabase keys
npm run dev
```

Open http://localhost:3000

## Schema migration

`supabase/schema.sql` is idempotent. Re-run the same SQL after any schema change.

## License

MIT
