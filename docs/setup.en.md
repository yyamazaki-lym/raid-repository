# Setup guide (full)

Everything needed to run Raid Repository for your own static. **Expect 20–40 minutes.**
This is the detailed version of [Getting started](../README.en.md#getting-started).

- Stuck? Run **`npm run doctor`** — it tells you which step is unfinished
- You collect **six values by hand** (five required + the admin role ID); `npm run setup` handles the rest
- `npm run setup` and `npm run doctor` print their messages **in Japanese**; the [troubleshooting](#troubleshooting) table quotes them

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

**Node.js 20.9+** if you want to run `npm run setup` locally (24 recommended, the same as CI).

> ⚠ **Discord is not optional.** The portal's front door is "you are a member of
> *this* Discord server". You need the bot even if you never use auto-import.

---

## The six values

| # | Value | Where to get it |
|---|---|---|
| 1 | Supabase Project URL | Supabase → Settings → API |
| 2 | Supabase anon key | same page |
| 3 | Supabase service_role key | same page (⚠ never expose to the browser) |
| 4 | Discord bot token | Developer Portal → Bot → Reset Token |
| 5 | Discord server ID | Discord (developer mode) → right-click server → Copy Server ID |
| 6 | Admin role ID | Discord → Server Settings → Roles → right-click → Copy Role ID (step 3-5) |

> ⚠ **Without value 6 (the admin role ID), nobody can edit content or change ⚙️ settings.**
> Unset is treated as "nobody is an admin" (it fails closed). Use the ID of a role you hold yourself.

The steps below collect these six values.

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

## 3. Create the Discord application and bot (10 min) — values 4–6

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

### 3-5. Server ID and admin role ID — values 5 and 6

1. Discord → Settings → Advanced → **Developer Mode** on
2. Right-click your server icon → **Copy Server ID** … value 5
3. Server Settings → **Roles** → right-click the role that should be allowed to edit
   (one you hold yourself) → **Copy Role ID** … value 6 (comma-separate several)

### 3-6. Invite the bot

1. **OAuth2 → URL Generator**
2. Scopes: **bot**
3. Bot permissions: **View Channels**, **Read Message History**,
   **Send Messages** (if you use session notices and attendance reminders),
   **Mention @everyone, @here, and All Roles** (if notices mention a role)
4. Open the generated URL and add it to your server

> ⚠ If the bot is **not in the server**, the member-check API is unavailable and
> logins fail.

---

## 4. Enable Discord login in Supabase (2 min)

1. https://supabase.com/dashboard → your project
2. **Authentication → Providers → Discord**
3. **Enable**
4. Paste the **Client ID** and **Client Secret** from step 3-2 → **Save**
5. On the same screen open **Email**, turn **Enable email provider off** → **Save**
   (this portal only uses Discord login, and new Supabase projects start with Email on.
   The database rules only let people confirmed as server members read or write, but
   close the entrance you don't use anyway)

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
2. Asks for the admin role ID (value 6; if unset, nobody can edit)
3. **Generates** `CRON_SECRET` and `SECRET_ENCRYPTION_KEY` for you
4. Writes `.env.local` (backing up an existing one to `.env.local.bak` first; both are
   written readable by you only, mode 0600)
5. Optionally applies `supabase/schema.sql` to create the tables
6. Runs the same diagnostics as `npm run doctor`

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
- If the password contains symbols such as `@ : / ? #`, the URI cannot be parsed.
  URL-encode those characters (`@` → `%40`, etc.) or use B

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
   - ⚠ **Do not paste** the `DEV_AUTH_BYPASS` / `PUBLIC_DEMO_MODE` lines
     (`PUBLIC_DEMO_MODE` removes the login gate even in production)
   - Mark the secrets (service_role key, bot token, `CRON_SECRET`,
     `SECRET_ENCRYPTION_KEY`, …) as **Sensitive** in Vercel so their values can no
     longer be read back from the dashboard
3. **Deploy** → you get `https://<project>.vercel.app` in a minute or two

### 6-1. Register the login return URL (skipping this always bites)

1. Supabase → **Authentication → URL Configuration**
2. **Site URL**: `https://<your-domain>`
3. **Redirect URLs**:
   ```
   https://<your-domain>/auth/callback
   http://localhost:3000/auth/callback
   ```
   - `vercel.json` disables deployments of anything other than `main`. If you enable
     preview deployments, add the preview domains too (e.g. `https://*-<team>.vercel.app/**`)
4. **Save**

> 💡 When you run `npm run dev` locally, open **`http://localhost:3000`** in the browser,
> not the `http://127.0.0.1:3000` printed in the terminal. The return URL is registered
> for `localhost`, so a login started from `127.0.0.1` cannot come back.

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

You can register **several schedules**. Each one is listed with the name read from
its source page (use the pencil button to set your own when no name can be read),
and the radio button on the left picks the one to display. Switching applies to
everyone, including the notification and snapshot jobs.

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

### 7-3. Register members

Settings → **Members**. The Discord IDs you enter here are what identify "you" in
my page, the attendance summary, BiS ownership, the who-wants-what matrix, and the
mitigation sheet's "my assignments" filter. **Register them in sync mode too** — in
sync mode the schedule table's attendance columns still come from the external sheet,
and this list is used only to identify members. Add each member's log name for
attendance matching.

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

> If you added `CRON_SECRET` after deploying, **Redeploy** in Vercel — a change to
> Vercel environment variables only applies to deployments created after it.

---

## 9. (Optional) Automate schema updates

When you `git pull` this repository and `supabase/schema.sql` has changed, a push can
apply it for you.

1. Take the Session pooler connection string from step 5
2. **GitHub Actions is disabled on a fresh fork.** Open your fork's **Actions** tab and
   click **I understand my workflows, go ahead and enable them**
   (otherwise the workflows in steps 9 and 10 never run)
3. Your fork → **Settings → Secrets and variables → Actions**
4. **New repository secret** → name `SUPABASE_DB_URL`, value the connection string

From then on, any push to `main` that touches `supabase/schema.sql` runs
"Deploy Database (Production)".

> If `gh` is installed, `npm run setup` offers to register this secret for you.

> Without the secret the workflow prints `Skipping: SUPABASE_DB_URL not set on this fork.`
> and succeeds, so nothing turns red if you prefer doing it by hand.

### When the schema changes

`supabase/schema.sql` is **idempotent** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Re-running it never destroys existing data. If you haven't set up step 9, paste the
new `schema.sql` into the SQL Editor again.

---

## 10. (Optional) Run the hourly session notice and attendance reminder

The "session confirmed" notice (native schedules) and the attendance reminder run
because Supabase pg_cron **calls your production URL every hour** (Vercel Hobby
crons run at most once a day, so the hourly part is started from the database).
You have to tell it where to call, once.

1. **Hand CRON_SECRET to Supabase**: run once in the SQL Editor
   ```sql
   SELECT vault.create_secret('<CRON_SECRET from .env.local>', 'cron_notify_native_schedule_bearer');
   ```
   - The SQL Editor keeps a history of queries. After running it, delete that query
     from the history (the list on the left)
   - If you later change `CRON_SECRET`, calling `create_secret` with the same name fails
     with a duplicate error. Update it instead:
     ```sql
     SELECT vault.update_secret(id, '<new CRON_SECRET>')
       FROM vault.secrets WHERE name = 'cron_notify_native_schedule_bearer';
     ```
2. **Re-apply the schema with the target URL** (your production URL from step 6, no path)
   - With step 9 set up: GitHub → **Settings → Secrets and variables → Actions →
     Variables** → **New repository variable** → Name `CRON_BASE_URL` /
     Value `https://<project>.vercel.app` → in the Actions tab, **Run workflow** on
     "Deploy Database (Production)"
   - By hand: add **one line at the top** of `schema.sql` in the SQL Editor and run it
     ```sql
     SET app.cron_base_url = 'https://<project>.vercel.app';
     ```
3. **Check**: run `SELECT jobname, command FROM cron.job;` — the three jobs
   `notify-native-schedule-hourly` / `attendance-reminder-hourly` /
   `warmup-portal-function` should point at **your** URL

Once registered, later schema runs keep the target (repeat step 2 only to change it).
Without a target the jobs are not registered (a NOTICE explains why).

> ⚠ **Forks that applied the schema before 2026-10-01** still have jobs pointing at
> the **upstream site** (the notice and reminder never ran, and your CRON_SECRET was
> sent upstream). Redo step 2.

---

## 11. (Optional) Import practice logs from FFLogs

Settings for the practice-logs tab (the practice-log summary).

1. **API key (public logs)**: log in to FFLogs → account settings → **Web API**, create
   a v1 key, and put it in `FFLOGS_API_KEY`
2. **OAuth (to include Private / Unlisted reports)**:
   1. https://www.fflogs.com/api/clients/ → **Create New Client**
   2. Register these two Redirect URLs (**exact match**; update them if your domain changes)
      ```
      https://<your-domain>/api/auth/fflogs/callback
      http://localhost:3000/api/auth/fflogs/callback
      ```
   3. Put the Client ID / Client Secret shown into `FFLOGS_OAUTH_CLIENT_ID` /
      `FFLOGS_OAUTH_CLIENT_SECRET`
   4. Make sure `SECRET_ENCRYPTION_KEY` is set
      (tokens are stored encrypted with this key; without it they cannot be saved)
3. Set them in both `.env.local` and Vercel, then **Redeploy**
4. In the portal, ⚙️ → the **FFLogs** integration section: set the FFLogs user name and,
   if you use OAuth, authorize with the connect button (one admin, once)

---

## Troubleshooting

Start with **`npm run doctor`**. Its output is in Japanese; the table below quotes each
message with its meaning.

| What doctor says | Meaning | What to do |
|---|---|---|
| `DISCORD_BOT_TOKEN 未設定` | `DISCORD_BOT_TOKEN` not set | Step 3-4 |
| `DISCORD_ADMIN_ROLE_IDS が未設定` | `DISCORD_ADMIN_ROLE_IDS` not set | Step 3-5, item 3 (role ID) |
| `Bot トークンが無効` | Bot token invalid | Reset the token and update both `.env.local` and Vercel |
| `Bot がサーバーに居ません` | Bot is not in the server | Redo the invite in step 3-6 |
| `メンバー一覧を取得できません (403)` | Cannot list members (403) | **SERVER MEMBERS INTENT** is off (step 3-4) |
| `Discord ログインが無効` | Discord login disabled | Step 4 (Supabase Providers) |
| `schema.sql が未適用` | Schema not applied | Step 5 |
| `anon キーが拒否されました` | anon key rejected | Re-copy it from Supabase → Settings → API |
| `秘密の値に NEXT_PUBLIC_ が付いています` | A secret has a `NEXT_PUBLIC_` prefix | Remove that variable and set it without the prefix |

Things doctor cannot see:

| Symptom | Cause / fix |
|---|---|
| `Invalid OAuth2 redirect_uri` on the Discord screen | The Redirects in step 3-3 (`https://<project ref>.supabase.co/auth/v1/callback`) |
| After login you land on the production top page (`/?code=…`) / never come back | Step 6-1; the Redirect URLs must match **exactly** |
| Bounced to `/auth/denied` | Bot not in the server, intent off, or wrong server ID |
| ⚙️ is missing / cannot save in the settings dialog | `DISCORD_ADMIN_ROLE_IDS` is unset, or you don't hold that role (if unset, nobody is an admin) |
| Errors when adding content | Schema probably not applied — run `npm run doctor` |
| Home page only shows guidance | No schedule mode selected yet (step 7-1) |

---

## See also

- Every environment variable: [`.env.local.example`](../.env.local.example)
- Suggested Discord channel layout (Japanese): [`guides/discord-setup.md`](guides/discord-setup.md)
- Notes for the log runner (Japanese): [`guides/log-runner.md`](guides/log-runner.md)
- Building a demo site (you don't need this): [`demo-site.md`](demo-site.md)
