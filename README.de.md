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
- **Automatische Erinnerung** an Mitglieder ohne Antwort, optional **automatische Bestätigung**, sobald alle geantwortet haben
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
- ⚠ **Individueller DPS wird weder gespeichert noch angezeigt.** Todesfälle enden bei „Job + Fähigkeit“, ohne Spielernamen

### Eigene Seite (`/me`)

Über das Personen-Symbol in der Kopfzeile. Zeigt **nur die eigenen Daten** (auch Admins sehen hier keine fremden Zeilen).

- Eigene Jobs (Standard plus Übersteuerung je Inhalt) — davon hängen die Filter der Mitigation-Tabelle ab
- **Fehlende BiS-Teile** und der **Lernpfad** als Fortschrittsbalken
- Einstieg in die Anwesenheitsübersicht

### Außerdem

- **Befehlspalette** (Strg+K) — Suche über Inhalte, Tabs und Aktionen hinweg
- **Discord-Auto-Import** — mit hinterlegten Kanal-IDs holt ein täglicher Lauf um 01:00 JST URLs aus den letzten 100 Nachrichten in den passenden Tab (per Knopf auch sofort)
- **Lernpfad** — geordnete Checkliste für neue Mitglieder: Video → Aufstellung → Makro → Mitigation
- **Themes** — sieben Erweiterungs-Themes mit eigenem Hintergrund
- **Eine fünfstufige Farbskala überall** (`src/lib/perf-tone.ts`) — gut = emerald → lime → amber → orange → rose = schlecht. ⚠ **Farbe trägt nie allein die Bedeutung** (Zahl oder Symbol stehen immer daneben)

---

## Technik

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase (Postgres + Realtime + RLS) · shadcn/ui + Base UI · Vercel (Auto-Deploy von `main`, Cron Jobs).

**Vier Schutzschichten**: ① Discord-OAuth-Gate im Proxy ② rollenabhängige Sichtbarkeit je Seite ③ Admin-Prüfung in jeder Server Action ④ RLS in der Datenbank. FFLogs-Tokens werden mit AES-256-GCM verschlüsselt abgelegt.

---

## Einrichtung (Kurzfassung, 20–40 Minuten)

**Von Hand sammelst du nur fünf Werte.** Die ausführliche Anleitung steht im [englischen Guide](docs/setup.en.md).

> ⚠ Beim Forken **den Repository-Namen ändern** (z. B. `pandora-raid`). Mit dem Standardnamen ist dein Fork von allen anderen nicht zu unterscheiden.

### 1. Fünf Werte sammeln (im Browser)

| # | Wert | Wo |
|---|---|---|
| 1–3 | Supabase **Project URL** / **anon** / **service_role** | Projekt bei [Supabase](https://supabase.com) anlegen → Settings → API |
| 4 | Discord **Bot-Token** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**SERVER MEMBERS INTENT einschalten**) |
| 5 | Discord **Server-ID** | Discord (Entwicklermodus) → Rechtsklick auf den Server |

Zwei weitere Dinge im Browser:

- In Discord **OAuth2 → Redirects** `https://<project ref>.supabase.co/auth/v1/callback` eintragen
- In Supabase **Authentication → Providers → Discord** aktivieren und Client ID / Secret einfügen

### 2. Konfiguration und Datenbank (ein Befehl)

```bash
npm install
npm run setup
```

Das Skript prüft jeden Wert bei der Eingabe, schreibt `.env.local`, **erzeugt** die Werte, die nur zufällig sein müssen, führt durch das **Anlegen der Tabellen** und lässt am Ende die Diagnose laufen.

### 3. Deployen und die Rücksprung-URL eintragen

Nach dem Deployment bei Vercel unter **Supabase → Authentication → URL Configuration** die Site URL und die Redirect URLs (`https://<deine Domain>/auth/callback` und `http://localhost:3000/auth/callback`) eintragen. **Ohne diesen Schritt kommt die Anmeldung nicht zurück.**

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

## Lizenz

MIT
