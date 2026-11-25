<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Lesen in: [日本語](README.md) | [English](README.en.md) | **Deutsch** | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

> Diese Seite ist die Kurzfassung. Die ausführliche Anleitung Schritt für Schritt und die Fehlerbehebung werden auf [Englisch](docs/setup.en.md) und [Japanisch](docs/setup.md) gepflegt.

Ein Portal für FINAL FANTASY XIV Raid-Statics: **Terminplan, Mitigation-Tabelle, Loot, Guides, Videos und Übungs-Logs** an einem Ort.

Eine Single-Tenant-App nach dem Prinzip „eine Gruppe = ein Deployment“ — **du forkst sie für deine eigene Static**. Die Eingangstür ist die Mitgliedschaft in deinem Discord-Server: nur wer dort Mitglied ist, kann sich anmelden.

🔗 **Demo (nur lesen): https://demo-raid-repository.vercel.app**
Zum Anklicken und Ausprobieren. **Eine eigene Demo brauchst du nicht.**

---

## Funktionen

### Terminplan

- **Drei Modi**: **nativ** (Kandidatentage, Anwesenheit ○ × △ und Bestätigung komplett im Portal) / **Sync** (Import aus character-sheets) / **aus**
- Der bestätigte Termin wird als **nächste Sitzung** hervorgehoben (am Tag selbst mit Countdown „beginnt in N h M min“)
- Mit **festen Wochentagen** entstehen Kandidatentage nur noch an diesen Tagen; der Dialog erzeugt sie auch **per Zeitraum × Wochentag** auf einmal. Tage außerhalb des Rasters tragen „Extra“ / „Nur diesmal“
- Zusätzlich zu ○ × △ können Mitglieder **verspätete Ankunft oder frühes Gehen** als Uhrzeit eintragen (erscheint als `21:30〜` neben dem Symbol)
- **Automatische Erinnerung** an Mitglieder ohne Antwort, optional **automatische Bestätigung**, sobald alle geantwortet haben. Mit Antwort-Knöpfen an der Erinnerung können Mitglieder **direkt in Discord antworten** (nativer Modus, optional)
- Discord-Vorlagen unterstützen `{discord_relative}` / `{discord_time}` — Discord zeigt sie in der Zeitzone der lesenden Person
- **Notizen pro Termin** mit Wichtigkeitsstufe. Verfassende und Admins dürfen sie bearbeiten; ältere Notizen ohne hinterlegte Urheberschaft darf jedes Mitglied aufräumen
- **Anwesenheitsübersicht** — gleicht die Antworten (○ × △) mit den tatsächlichen Übungs-Logs der letzten 90 Tage ab und listet die Abweichungen. Funktioniert in beiden Modi

### Inhalte (Kategorien)

- Pro Raid-Inhalt ein **Status** (nicht begonnen / in Arbeit / geschafft / pausiert), Sortierung per Drag-and-drop, Sofort-Sync über Realtime
- Jede Karte zeigt eine **Fortschritts-Sparkline der letzten 8 Wochen**
- **Schwierigkeitsbezeichnung** und **Fortschrittsmodell** (Ebenen / Phasen) sind pro Inhalt einstellbar — funktioniert auch, bevor die Namen eines neuen Tiers bekannt sind
- Ein Hintergrundbild ist möglich, inklusive **welcher Ausschnitt** gezeigt wird

### Unter-Tabs pro Inhalt

| Tab | Inhalt |
|---|---|
| **Mitigation** | Eure bestehende Google-Tabelle, eingebettet. **Auf dem Handy als schreibgeschützte Kartenansicht**, filterbar nach „meine Rolle“ / „nur meine Zuständigkeit“ |
| **Loot** | Ebenfalls die Tabelle, dazu die **Wochen-Checkliste** (Reset Dienstag 17:00 JST) und **BiS** (XivGear-Einbettung). Die „Wer will was“-Matrix lässt sich einklappen |
| **Guides** | Linkliste (Titel automatisch, Tags, gelesen/ungelesen). Google Docs/Sheets erscheinen als Karte mit erkennbarem Dateityp |
| **Videos** | YouTube-Vorschau mit Klick zum Abspielen, Links zu FFLogs / XIVAnalysis |
| **Makros** | Spielmakros mit Ein-Klick-Kopie; im selben Tab **Waymark-Presets** und **Strategy-Board-Codes** |
| **Übungs-Logs** | siehe unten |

### Übungs-Logs

Daten aus FFLogs, pro Pull importiert.

- Pulls gesamt / Übungstage / weiteste Phase / Clears, dazu ein Fortschrittsbalken je Tag
- Von jedem Pull mit einem Klick **an die passende Stelle** in FFLogs, XIVAnalysis oder im Video
- **Wipe-Ursachen** (der zuerst gefallene Job ← die tödliche Fähigkeit) und an welcher Mechanik es scheitert; auch **was unmittelbar vor dem Tod passierte**
- Ultimates zeigen **Verweildauer je Phase** und die erste Ankunft dort, Savage die **erste Clear je Ebene**
- Ein Tag wird als **Reihe von Pull-Kästchen** gezeichnet (ein Kästchen = ein Pull, `✓` für einen Clear)
- **Fehlernotizen** pro Pull lassen sich nachträglich ergänzen
- **Lücken füllen** — Termine ohne jedes Log werden aufgelistet; an Tagen, an denen ACT nicht lief, lassen sich Pulls und Fortschritt **von Hand eintragen**, damit sie in die Summen eingehen. Tage ohne Training lassen sich als abgesagt markieren
- ⚠ **Individueller DPS wird weder gespeichert noch angezeigt.** Todesfälle enden bei „Job + Fähigkeit“, ohne Spielernamen

### Eigene Seite (`/me`)

Über das Personen-Symbol in der Kopfzeile. Zeigt **nur die eigenen Daten** (auch Admins sehen hier keine fremden Zeilen).

- Eigene Jobs (Standard plus Übersteuerung je Inhalt) — davon hängen die Filter der Mitigation-Tabelle ab
- **Fehlende BiS-Teile** und der **Lernpfad** als Fortschrittsbalken
- Einstieg in die Anwesenheitsübersicht

### Außerdem

- **Befehlspalette** (Strg+K) — Suche über Inhalte, Tabs und Aktionen hinweg
- **Discord-Auto-Import** — mit hinterlegten Kanal-IDs holt ein täglicher Lauf um 01:00 JST URLs aus den letzten 100 Nachrichten in den passenden Tab (per Knopf auch sofort)
- **YouTube-Playlist-Import** — nicht gelistete Videos erscheinen nicht in der Videoliste eines Kanals; leg sie in eine Playlist und hinterleg diese, dann holt sie derselbe tägliche Lauf in den Video-Tab (braucht einen YouTube-API-Schlüssel)
- **Benachrichtigungen zu den Übungs-Logs** — neue Reports, neuer Bestwert, erster Clear und dienstagmorgens eine **Wochenzusammenfassung** (Pulls, weitester Fortschritt, erste Durchbrüche und Clears der Vorwoche) in Discord. Jede Art einzeln schaltbar, standardmäßig alle aus
- **Lernpfad** — geordnete Checkliste für neue Mitglieder: Video → Aufstellung → Makro → Mitigation
- **Themes** — sieben Erweiterungs-Themes mit eigenem Hintergrund
- **Eine fünfstufige Farbskala überall** (`src/lib/perf-tone.ts`) — gut = emerald → lime → amber → orange → rose = schlecht. ⚠ **Farbe trägt nie allein die Bedeutung** (Zahl oder Symbol stehen immer daneben)

---

## Technik

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase (Postgres + Realtime + RLS) · shadcn/ui + Base UI · Vercel (Auto-Deploy von `main`, Cron Jobs).

### Vier Schutzschichten

1. **Proxy** — das Discord-OAuth-Gate; wer nicht Mitglied des Servers ist, kommt nicht hinein
2. **Seite** — rollenabhängige Sichtbarkeit
3. **Server Action** — jeder Schreibzugriff prüft erneut auf Admin
4. **RLS** — die Datenbank setzt dieselbe Regel durch (an der App vorbei hilft nichts)

FFLogs-Tokens werden mit AES-256-GCM verschlüsselt abgelegt.

---

## Einrichtung (Kurzfassung, 20–40 Minuten)

**Von Hand sammelst du nur sechs Werte** (fünf Pflichtwerte + die Admin-Rollen-ID). Die ausführliche Anleitung steht im [englischen Guide](docs/setup.en.md).

> ⚠ Beim Forken **den Standardnamen `raid-repository` ändern** (z. B. `pandora-raid` oder `tuesday-night-raid`). Mit dem Standardnamen ist dein Fork von allen anderen nicht zu unterscheiden. Der Name wird auch zum Standardnamen des Vercel-Projekts.

### 1. Sechs Werte sammeln (im Browser)

| # | Wert | Wo |
|---|---|---|
| 1–3 | Supabase **Project URL** / **anon** / **service_role** | Projekt bei [Supabase](https://supabase.com) anlegen → Settings → API |
| 4 | Discord **Bot-Token** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**SERVER MEMBERS INTENT einschalten**) |
| 5 | Discord **Server-ID** | Discord (Entwicklermodus) → Rechtsklick auf den Server |
| 6 | **Admin-Rollen-ID** (`DISCORD_ADMIN_ROLE_IDS`) | Discord → Servereinstellungen → Rollen → Rechtsklick → Rollen-ID kopieren. **Ohne diesen Wert kann niemand Inhalte bearbeiten oder Einstellungen ändern** |

Drei weitere Dinge im Browser:

- Den Bot auf deinen Server einladen (Developer Portal → **OAuth2 → URL Generator** → Scopes `bot`). **Ist der Bot nicht auf dem Server, kann sich niemand anmelden**
- In Discord **OAuth2 → Redirects** `https://<project ref>.supabase.co/auth/v1/callback` eintragen
- In Supabase **Authentication → Providers → Discord** aktivieren und Client ID / Secret einfügen

### 2. Konfiguration und Datenbank (Befehle)

Dieses Repository **forken** und dann deinen Fork klonen:

```bash
git clone https://github.com/<du>/<dein-fork>.git
cd <dein-fork>
npm install
npm run setup
```

Das Skript prüft jeden Wert bei der Eingabe, schreibt `.env.local`, **erzeugt** die Werte, die nur zufällig sein müssen, führt durch das **Anlegen der Tabellen** und lässt am Ende die Diagnose laufen.

### 3. Deployen und die Rücksprung-URL eintragen

In [Vercel](https://vercel.com/new) **Add New → Project** wählen, **deinen eigenen Fork** importieren, den gesamten Inhalt von `.env.local` unter **Environment Variables** einfügen und deployen (inklusive `CRON_SECRET`, `SECRET_ENCRYPTION_KEY` und `DISCORD_ADMIN_ROLE_IDS`; Details in Schritt 6 der [Anleitung](docs/setup.en.md#6-deploy-to-vercel-5-min)). ⚠ Die Zeilen `DEV_AUTH_BYPASS` / `PUBLIC_DEMO_MODE` nicht einfügen.

Sobald die Domain feststeht, unter **Supabase → Authentication → URL Configuration** die Site URL und die Redirect URLs (`https://<deine Domain>/auth/callback` und `http://localhost:3000/auth/callback`) eintragen. **Ohne diesen Schritt kommt die Anmeldung nicht zurück.**

```bash
npm run doctor -- --url https://<deine Domain>
```

### Wenn etwas nicht läuft

```bash
npm run doctor
```

Prüft per echtem API-Aufruf: Umgebungsvariablen, Erreichbarkeit von Supabase, ob das Schema eingespielt ist, ob Discord-Login aktiv ist, ob Bot-Token und Server-Mitgliedschaft stimmen und ob **SERVER MEMBERS INTENT** wirklich an ist — mit einer Lösung zu jedem `❌`.

---

## Lokale Entwicklung

```bash
npm install
npm run setup   # beim ersten Mal (erzeugt .env.local)
npm run dev
```

http://localhost:3000 öffnen (im Terminal steht `127.0.0.1`, aber die Rücksprung-URL der Anmeldung ist für `localhost` eingetragen — also `localhost` verwenden).

| Befehl | Was er tut |
|---|---|
| `npm run setup` | Interaktive Einrichtung (`.env.local` → Schema → Diagnose) |
| `npm run doctor` | Konfiguration prüfen; mit `-- --url https://…` auch ein Deployment |
| `npm run dev` | Entwicklungsserver (an `127.0.0.1` gebunden, also nur von diesem Rechner erreichbar: `DEV_AUTH_BYPASS` macht dich zum Admin, daher bleiben andere Geräte im selben WLAN draußen) |
| `npm run build` | Produktions-Build |
| `npm run lint` | ESLint |

`scripts/check-*.mjs` sind Prüfungen für reine Funktionen und Verträge; die CI führt alle aus.

---

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`docs/setup.en.md`](docs/setup.en.md) | **Ausführliche Einrichtung** und Fehlerbehebung (Englisch) |
| [`docs/backlog.md`](docs/backlog.md) | Offene Aufgaben (Japanisch) |
| [`docs/guides/discord-setup.md`](docs/guides/discord-setup.md) | Empfohlene Discord-Kanalstruktur (Japanisch) |
| [`docs/guides/log-runner.md`](docs/guides/log-runner.md) | Hinweise für die Person, die die Logs aufnimmt (Japanisch) |
| [`docs/demo-site.md`](docs/demo-site.md) | Wie die Demo-Seite gebaut ist (**brauchst du nicht**) |
| [`docs/release-notes/`](docs/release-notes/) | Details je Release (die Einzeiler in der App stehen in `src/lib/changelog.ts`) |
| [`.env.local.example`](.env.local.example) | Alle Umgebungsvariablen mit Erläuterungen |

---

## Marke

Die Logos liegen in `public/brand/`. In `logo-mark.svg` ist der Kristall das Gefäß für das gesammelte Wissen der Gruppe, die acht Punkte darum die Achter-Gruppe: oben zwei Tanks (blau), unten zwei Heiler (grün), seitlich vier DPS (rot). `logo-wordmark-dark.svg` / `logo-wordmark-light.svg` sind die Schriftzug-Varianten für dunkle und helle Hintergründe; der Kopf dieses READMEs wechselt automatisch. Dieselbe Marke ist Favicon, iOS-Homescreen-Symbol, Anmeldebildschirm und Startbildschirm beim Kaltstart.

`social-preview.png` (1280×640) ist das Bild, das GitHub auf der Repository-Karte zeigt. **Manuell unter Settings → Social preview hochladen** — über die GitHub-API lässt es sich nicht setzen.

---

## Lizenz

MIT

Die Schriften in `src/app/fonts/` (Geist, JetBrains Mono, Orbitron) stehen unter der SIL Open Font License 1.1 (siehe die jeweilige `OFL-*.txt`).
