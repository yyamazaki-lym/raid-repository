<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Read in: [日本語](README.md) | **English** | [Deutsch](README.de.md) | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

A portal for a Final Fantasy XIV static: **schedule, mitigation sheets, loot, strategy links, videos, and practice logs** in one place.

It is a single-tenant app built on the assumption of "one static = one deployment" — **you fork it for your own group**. The front door is your Discord server: only members of that server can log in.

🔗 **Live demo (read-only): https://demo-raid-repository.vercel.app**
Click around to see the real thing. **You do not need to build a demo of your own** — to run it for your static, see [Getting started](#getting-started).

---

## What it does

### Schedule

- **Three source modes**: **native** (add candidate dates, collect ○ × △, confirm the session — all inside the portal) / **sync** (import from [character-sheets](https://character-sheets.appspot.com/schedule/)) / **off**
- Confirmed sessions are highlighted as **the next run** (on the day itself, with a "starts in N h M m" countdown)
- Set your **regular days** (e.g. every Tue/Thu/Sat) and candidate dates are auto-added only on those days. A dialog can **bulk-generate a date range × weekdays**. Days outside the regular pattern get an "extra" / "one-off" badge
- Beyond ○ × △, members can enter **an arrival time when late or a leaving time when early** (shown as `21:30〜` next to the symbol)
- **Automatic nudges** for people who haven't answered, and **auto-confirm** once everyone has (optional)
- Discord notification templates support `{discord_relative}` / `{discord_time}`, which render in each reader's own timezone ("in 3 hours")
- Per-date **memos** with a severity label. The author and admins can edit them; older memos with no recorded author can be cleaned up by any member
- **Attendance summary** — reconciles answers (○ × △) against actual practice logs for the last 90 days and lists the mismatches. Works in both native and sync modes

### Content (categories)

- Per-encounter **status** (not started / practising / cleared / on hold), drag to reorder, shared instantly via Realtime
- Each card carries an **8-week progress sparkline** — you see where you are without opening a tab
- **Difficulty label** and **progression model** (floors / phases) are set per encounter, so a new tier works even before its naming is announced
- A background image can be set per card, including **which part of the image to show**

### Tabs per encounter

| Tab | What's in it |
|---|---|
| **Mitigation** | Your existing Google Sheet, embedded. **On mobile it is rebuilt as read-only cards** that can be filtered to "my role" / "my assignments only" |
| **Loot** | Same sheet embedding, plus a **weekly-lockout checklist** (resets Tue 17:00 JST) and **BiS** (XivGear embed). The "who wants it" matrix is collapsible |
| **Strategy** | Link collection (titles fetched automatically, tags, read state). Google Docs/Sheets links show a typed card instead of a thumbnail |
| **Videos** | YouTube thumbnails with click-to-play, links out to FFLogs / XIVAnalysis |
| **Macros** | One-tap copy of in-game macros. **Waymark presets** and **strategy-board share codes** live in the same tab |
| **Practice logs** | See below |

### Practice logs

Pull-level data imported from FFLogs.

- Total pulls / practice days / best phase reached / clear count, with a per-day progress bar
- From any pull, jump straight **to that moment** in FFLogs, XIVAnalysis, or the video
- **Wipe causes** (the first job to die ← the killing ability) and which mechanic keeps breaking. You can also see **what happened right before the death**
- Ultimates get **time spent per phase** and first arrival at each phase; savage gets **first clear per floor**
- A day is drawn as a **row of pull boxes** (one box = one pull, `✓` for a clear)
- **Mistake notes** per pull — write down "this is what went wrong here" after the fact
- ⚠ **Individual DPS is never stored or shown.** Death records stop at "job + ability" and carry no player names

### Your own page (`/me`)

Opened from the person icon in the header. It shows **only your own data** (admins do not see other people's rows here).

- Your job setup (a default plus per-encounter overrides). This drives the mitigation-sheet filters
- **Remaining BiS** and **learning path** progress, drawn as bars
- An entry point to the attendance summary

### Everything else

- **Command palette** (Ctrl+K) — search across encounters, tabs, and actions
- **Discord auto-import** — register strategy / video channel IDs per encounter and a daily 01:00 JST job pulls URLs from the last 100 messages into the right tab (a button runs it on demand too)
- **Learning path** — an ordered checklist for new members: video → positions → macro → mitigation
- **Themes** — seven expansion themes, each with its own background treatment
- **One five-step colour scale everywhere** (`src/lib/perf-tone.ts`) — good = emerald → lime → amber → orange → rose = bad, used for remaining HP, deaths, progress bars, attendance symbols, and weekly lockouts. ⚠ **Colour never carries meaning on its own** (a number or symbol is always next to it)

---

## Getting started

**You collect six values by hand** (five required + the admin role ID); the rest is scripted. Expect 20–40 minutes. Screen-by-screen detail lives in **[`docs/setup.en.md`](docs/setup.en.md)**.

> ### ⚠ Before you fork
>
> On the page the Fork button takes you to, **change the default repository name `raid-repository`**. Leaving it means your fork is indistinguishable from everyone else's (pick something like `pandora-raid` or `tuesday-night-raid`). It also becomes the default Vercel project name.

### 1. Collect six values (in the browser)

| # | Value | Where |
|---|---|---|
| 1–3 | Supabase **Project URL** / **anon** / **service_role** | Create a project at [Supabase](https://supabase.com), then Settings → API |
| 4 | Discord **bot token** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**turn SERVER MEMBERS INTENT on**) |
| 5 | Discord **server ID** | Discord (developer mode) → right-click the server |
| 6 | **Admin role ID** (`DISCORD_ADMIN_ROLE_IDS`) | Discord → Server Settings → Roles → right-click → Copy Role ID. **If unset, nobody can edit content or change settings** |

Three more things in the browser:

- Invite the bot to your server (Developer Portal → **OAuth2 → URL Generator** → Scopes `bot`). **If the bot is not in your server, nobody can log in**
- Add `https://<project ref>.supabase.co/auth/v1/callback` under Discord **OAuth2 → Redirects**
- Turn on **Authentication → Providers → Discord** in Supabase and paste the Discord Client ID / Secret

### 2. Config and database (commands)

**Fork** this repository, then clone your fork:

```bash
git clone https://github.com/<you>/<your-fork>.git
cd <your-fork>
npm install
npm run setup
```

`npm run setup` validates each value as you type it, writes `.env.local`, generates the values that only need to be random (`CRON_SECRET` and friends), walks you through **creating the tables**, and finishes by running the diagnostics.

### 3. Deploy, then register the return URL

In [Vercel](https://vercel.com/new), **Add New → Project**, import **your own fork**, paste the whole of `.env.local` into **Environment Variables**, and Deploy (including `CRON_SECRET`, `SECRET_ENCRYPTION_KEY`, and `DISCORD_ADMIN_ROLE_IDS`; details in step 6 of [`docs/setup.en.md`](docs/setup.en.md#6-deploy-to-vercel-5-min)). ⚠ Do not paste the `DEV_AUTH_BYPASS` / `PUBLIC_DEMO_MODE` lines.

Once the deployment gives you a domain, add it under **Supabase → Authentication → URL Configuration**: the Site URL, plus `https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback` as Redirect URLs. **Skip this and login will not come back to your site.**

```bash
npm run doctor -- --url https://<your-domain>
```

### When something doesn't work

```bash
npm run doctor
```

It checks the environment variables, whether Supabase answers, whether the schema is applied, whether Discord login is enabled, whether the bot token works and the bot is in your server, and whether **SERVER MEMBERS INTENT** is really on — by calling the APIs. Every `❌` comes with the fix.

---

## Tech

Next.js 16 + React 19 + Tailwind CSS v4 / Supabase (Postgres + Realtime + RLS) / shadcn/ui + Base UI / Vercel (auto-deploy from `main`, Cron Jobs).

### Four layers of defence

1. **Proxy** — the Discord OAuth gate; non-members never get inside
2. **Page** — role-based visibility
3. **Server Action** — every write re-checks admin
4. **RLS** — the database enforces the same rule (bypassing the app doesn't help)

FFLogs tokens are stored encrypted with AES-256-GCM.

---

## Local development

```bash
npm install
npm run setup   # first time; writes .env.local (or copy .env.local.example by hand)
npm run dev
```

Open http://localhost:3000 (the terminal prints `127.0.0.1`, but the login return URL is registered for `localhost`, so open `localhost`).

| Command | What it does |
|---|---|
| `npm run setup` | Interactive setup (`.env.local` → schema → diagnostics) |
| `npm run doctor` | Diagnose the configuration; add `-- --url https://…` to check a deployment |
| `npm run dev` | Dev server (bound to `127.0.0.1`, so only this computer can open it: `DEV_AUTH_BYPASS` makes you admin, so other devices on the same Wi-Fi are kept out) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

`scripts/check-*.mjs` are pure-function and contract checks; CI runs all of them.

---

## Documentation

| File | Contents |
|---|---|
| [`docs/setup.en.md`](docs/setup.en.md) | **Full setup guide** and troubleshooting |
| [`docs/backlog.md`](docs/backlog.md) | Remaining work (Japanese) |
| [`docs/guides/discord-setup.md`](docs/guides/discord-setup.md) | Suggested Discord channel layout (Japanese) |
| [`docs/guides/log-runner.md`](docs/guides/log-runner.md) | Notes for whoever runs the logs (Japanese) |
| [`docs/demo-site.md`](docs/demo-site.md) | How the demo site is built (**you don't need this**) |
| [`docs/release-notes/`](docs/release-notes/) | Per-release detail (the one-liners shown in-app live in `src/lib/changelog.ts`) |
| [`.env.local.example`](.env.local.example) | Every environment variable, with notes |

---

## Brand

The logos live in `public/brand/`. In `logo-mark.svg` the crystal is the vessel that holds what the group has learned, and the eight points around it are the eight-player party: two tanks on top (blue), two healers below (green), four DPS on the sides (red). `logo-wordmark-dark.svg` / `logo-wordmark-light.svg` are the wordmark versions for dark and light backgrounds, and the header of this README switches between them automatically. The same mark is the favicon, the iOS home-screen icon, the login screen, and the cold-start splash.

`social-preview.png` (1280×640) is the card GitHub shows when the repository is linked. **Upload it manually from Settings → Social preview** — GitHub's API cannot set it.

---

## License

MIT

The fonts in `src/app/fonts/` (Geist, JetBrains Mono, Orbitron) are under the SIL Open Font License 1.1 (see each font's `OFL-*.txt`).
