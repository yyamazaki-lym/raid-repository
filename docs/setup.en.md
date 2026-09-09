# Setup guide (full)

Everything needed to run Raid Repository for your own static. **Expect 20–40 minutes.**
This is the detailed version of [Getting started](../README.en.md#getting-started).

- Stuck? Run **`npm run doctor`** — it tells you which step is unfinished
- You collect **five values by hand**; `npm run setup` handles the rest

> The [demo site](https://demo-raid-repository.vercel.app) exists to show what the app
> looks like. **You do not need one for your own static** (if you ever do want one,
> see [`demo-site.md`](demo-site.md), but you can safely ignore it).

---

## What you need

| | Account | For | Cost |
|---|---|---|---|
| Required | [GitHub](https://github.com) | The repository | Free |
| Required | [Supabase](https://supabase.com) | Database + realtime | Free tier is enough |
| Required | [Vercel](https://vercel.com) | Hosting | Hobby tier is enough |
| Required | [Discord Developer](https://discord.com/developers/applications) | The login gate (is this person in the server?) | Free |

**Node.js 20+** if you want to run `npm run setup` locally.

> ⚠ **Discord is not optional.** The portal's front door is "you are a member of
> *this* Discord server". You need the bot even if you never use auto-import.

---

## The five values

| # | Value | Where to get it |
|---|---|---|
| 1 | Supabase Project URL | Supabase → Settings → API |
| 2 | Supabase anon key | same page |
| 3 | Supabase service_role key | same page (⚠ never expose to the browser) |
| 4 | Discord bot token | Developer Portal → Bot → Reset Token |
| 5 | Discord server ID | Discord (developer mode) → right-click server → Copy Server ID |

---

## 1. Fork (1 min)

1. **Fork** this repository
2. **Change the repository name** (e.g. `pandora-raid`, `tuesday-night-raid`)
   - Keeping `raid-repository` makes your fork indistinguishable from everyone else's
   - It also becomes the default Vercel project name, so decide it now
3. **Create fork**

---

## 2. Create the Supabase project (5 min) — values 1–3

1. Sign in at https://supabase.com (GitHub sign-in is easiest)
2. **New project**

   | Field | Suggested |
   |---|---|
   | Name | anything (e.g. `raid-repository`) |
   | Database Password | auto-generate, then **keep it** (used to apply the schema) |
   | Region | the one nearest your group |
   | Plan | **Free** |

3. After it is created, open **Settings → API** and copy:
   - **Project URL** (`https://xxxxx.supabase.co`) … value 1
   - **anon public** … value 2
   - **service_role** … value 3

> ⚠ **The service_role key must never reach the browser.** It bypasses RLS entirely.
> Do not prefix it with `NEXT_PUBLIC_` (that publishes it). `npm run doctor` catches
> that mistake.

> 💡 The `xxxxx` part of the Project URL (the project ref) is used again in step 3.

---

## 3. Create the Discord application and bot (10 min) — values 4–5

### 3-1. Application

1. https://discord.com/developers/applications → **New Application** → name it → **Create**

### 3-2. OAuth2 client ID / secret

1. **OAuth2** in the left menu
2. Copy the **CLIENT ID**
3. **CLIENT SECRET** → **Reset Secret** → copy it (shown only once)

> These two are **only pasted into Supabase** (step 4). They never go into
> `.env.local` or Vercel environment variables.

### 3-3. Redirect URI

On the same **OAuth2** page, **Redirects** → **Add Redirect**:

```
https://<project ref>.supabase.co/auth/v1/callback
```

**This is Supabase's fixed callback**, so it never changes even if your Vercel domain does.

### 3-4. Enable the bot and its intents — value 4

1. **Bot** in the left menu
2. **Privileged Gateway Intents**
   - **SERVER MEMBERS INTENT** → **on**. With this off, **nobody can log in**
   - **MESSAGE CONTENT INTENT** → on if you want Discord auto-import
   - **Save Changes**
3. **Token** → **Reset Token** → copy … value 4

### 3-5. Server ID — value 5

1. Discord → Settings → Advanced → **Developer Mode** on
2. Right-click your server icon → **Copy Server ID** … value 5

### 3-6. Invite the bot

1. **OAuth2 → URL Generator**
2. Scopes: **bot**
3. Bot permissions: **View Channels**, **Read Message History**
4. Open the generated URL and add it to your server

> ⚠ If the bot is **not in the server**, the member-check API is unavailable and
> logins fail.

---

## 4. Enable Discord login in Supabase (2 min)

1. https://supabase.com/dashboard → your project
2. **Authentication → Providers → Discord**
3. **Enable**
4. Paste the **Client ID** and **Client Secret** from step 3-2 → **Save**

> Site URL / Redirect URLs (the Vercel side) come later, in step 6, once you have a domain.

---

## 5. Config file and database (5 min)

From here a command does the work. Clone your fork and run:

```bash
git clone https://github.com/<you>/<your-repo>.git
cd <your-repo>
npm install
npm run setup
```

`npm run setup`:

1. Asks for values 1–5 and **validates the shape of each one as you type**
2. **Generates** `CRON_SECRET` and `SECRET_ENCRYPTION_KEY` for you
3. Writes `.env.local` (backing up an existing one to `.env.local.bak` first)
4. Optionally applies `supabase/schema.sql` to create the tables
5. Runs the same diagnostics as `npm run doctor`

> ⚠ **What cannot be automated**: creating the Supabase project, creating the Discord
> application, and the Supabase Authentication settings. Those only exist in web
> dashboards — which is why steps 2–4 are manual.

### Creating the tables

**A. From setup** — needs a Supabase connection string.

- Supabase → **Settings → Database → Connection string** → **Session pooler** tab
  - ⚠ **Session pooler, not Direct connection.** Direct is IPv6-only on the free
    plan and GitHub Actions cannot reach it either
- Replace `[YOUR-PASSWORD]` with the database password from step 2
- Requires `psql` locally (otherwise use B)

**B. Paste into the SQL Editor** — works without psql.

1. Supabase → **SQL Editor** → **New query**
2. Paste the whole of [`supabase/schema.sql`](../supabase/schema.sql) (use GitHub's Raw view)
3. **Run** → `Success. No rows returned`

Either way, you are done when `npm run doctor` reports the schema as applied.

---

## 6. Deploy to Vercel (5 min)

1. **Import** your fork at https://vercel.com/new
   - The first time, use **Adjust GitHub App Permissions** so Vercel can see the fork
2. Paste your `.env.local` contents into **Environment Variables**
   - Vercel's field accepts a whole `.env` blob and splits it into keys/values
   - ⚠ Do not add a `NEXT_PUBLIC_` prefix to anything that didn't have one
3. **Deploy** → you get `https://<project>.vercel.app` in a minute or two

### 6-1. Register the login return URL (skipping this always bites)

1. Supabase → **Authentication → URL Configuration**
2. **Site URL**: `https://<your-domain>`
3. **Redirect URLs**:
   ```
   https://<your-domain>/auth/callback
   http://localhost:3000/auth/callback
   ```
   - Add `https://<your-domain>/**` too if you use preview deployments
4. **Save**

### 6-2. Verify

```bash
npm run doctor -- --url https://<your-domain>
```

Then open the site, log in with Discord, and confirm you land on the top page.

---

## 7. First-run configuration (5 min)

A fresh deployment is **an empty portal**. Everything below is behind the ⚙️ icon.

### 7-1. Pick a schedule mode

| Mode | When |
|---|---|
| **Native** | You want candidate dates, attendance, and confirmation inside the portal |
| **Sync** | You already run your schedule in [character-sheets](https://character-sheets.appspot.com/schedule/) |
| **Off** | You don't want the schedule feature at all |

For sync mode, put your `https://character-sheets.appspot.com/schedule/list?key=...`
URL into **Schedule Source**. It is stored in the database and **shared by everyone**.

### 7-2. Add your encounters

**Content** tab → **+ add**.

| Field | Notes |
|---|---|
| Name | Display name |
| Slug | Used in the URL (e.g. `arcadion-heavy`) |
| Status | Not started / practising / cleared / on hold |
| Mitigation URL | Google Sheet (optional) |
| Loot URL | Google Sheet (optional) |
| Discord channel IDs | For auto-import (optional) |

Any of these Google Sheets URL shapes work:

| Kind | Shape | How |
|---|---|---|
| Published to web | `.../pubhtml` | File → Share → Publish to web |
| Embed | `.../e/.../pubhtml?widget=true` | same |
| Normal share link | `.../edit#...` | only if "anyone with the link can view" |

### 7-3. Register members (native mode)

Settings → **Members**. The Discord IDs you enter here are what identify "you" in
the attendance table, the attendance summary, BiS ownership, and the mitigation
sheet's "my assignments" filter.

---

## 8. (Optional) Discord auto-import

Pulls URLs from the last 100 messages of a channel into the strategy / video tabs
(daily at 01:00 JST, plus a button).

1. **Let the bot see the channel**: right-click the channel → Edit Channel →
   Permissions → add the bot → allow **View Channel** and **Read Message History**
2. **Register the channel ID**: right-click the channel → Copy ID → paste it into the
   encounter's edit dialog
3. **Check it**: the **Discord import** button on the content list

| Message | Meaning |
|---|---|
| `+N imported` | Worked |
| `no URLs found` | Empty channel, or the bot cannot see it (revisit 1) |
| `error: discord 401/403` | Bot token or permission problem |

> If you added `CRON_SECRET` after deploying, **redeploy** — environment variables
> are baked in at build time.

---

## 9. (Optional) Automate schema updates

When you `git pull` this repository and `supabase/schema.sql` has changed, a push can
apply it for you.

1. Take the Session pooler connection string from step 5
2. Your fork → **Settings → Secrets and variables → Actions**
3. **New repository secret** → name `SUPABASE_DB_URL`, value the connection string

From then on, any push to `main` that touches `supabase/schema.sql` runs
"Deploy Database (Production)".

> If `gh` is installed, `npm run setup` offers to register this secret for you.

> Without the secret the workflow prints `Skipping: SUPABASE_DB_URL not set on this fork.`
> and succeeds, so nothing turns red if you prefer doing it by hand.

### When the schema changes

`supabase/schema.sql` is **idempotent** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Re-running it never destroys existing data.

---

## Troubleshooting

Start with **`npm run doctor`**.

| What doctor says | What to do |
|---|---|
| `DISCORD_BOT_TOKEN not set` | Step 3-4 |
| Bot token invalid | Reset the token and update both `.env.local` and Vercel |
| Bot is not in the server | Redo the invite in step 3-6 |
| Cannot list members (403) | **SERVER MEMBERS INTENT** is off (step 3-4) |
| Discord login disabled | Step 4 |
| Schema not applied | Step 5 |
| anon key rejected | Re-copy it from Settings → API |
| A secret has a `NEXT_PUBLIC_` prefix | Remove that variable and set it without the prefix |

Things doctor cannot see:

| Symptom | Cause / fix |
|---|---|
| `redirect_uri_mismatch` after login | Step 6-1; the Redirect URLs must match **exactly** |
| Bounced to `/auth/denied` | Bot not in the server, intent off, or wrong server ID |
| Cannot save in the settings dialog | You may not hold an admin role (`DISCORD_ADMIN_ROLE_IDS`) |
| Errors when adding content | Schema probably not applied — run `npm run doctor` |
| Home page only shows guidance | No schedule mode selected yet (step 7-1) |

---

## See also

- Every environment variable: [`.env.local.example`](../.env.local.example)
- Suggested Discord channel layout (Japanese): [`guides/discord-setup.md`](guides/discord-setup.md)
- Notes for the log runner (Japanese): [`guides/log-runner.md`](guides/log-runner.md)
- Building a demo site (you don't need this): [`demo-site.md`](demo-site.md)
