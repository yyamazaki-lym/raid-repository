<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Lesen in: [日本語](README.md) | [English](README.en.md) | **Deutsch** | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

> Diese Seite beschreibt Funktionen und Einrichtung in Kurzform. Die vollständige Schritt-für-Schritt-Anleitung (mit Screenshots-Beschreibungen, Umgebungsvariablen und Fehlerbehebung) wird auf [Englisch](README.en.md) und [Japanisch](README.md) gepflegt.

Ein Portal für FINAL FANTASY XIV Raid-Statics: Terminplan, Mitigation-Tabelle, Loot-Verwaltung, Guides, Videos und Übungs-Logs an einem Ort.

Gebaut nach dem Prinzip „eine Gruppe = ein Deployment“: eine Single-Tenant-App, die du für deine eigene Static forkst und betreibst.

## Live-Demo

Öffentliche, schreibgeschützte Demo: 🔗 **https://demo-raid-repository.vercel.app**

## Funktionen

### Terminplan
- Drei Quellmodi: **Sync** (Import von character-sheets), **Nativ** (Kandidatentage, Anwesenheit ○ × △ und Bestätigung direkt im Portal, mit FFLogs-Verknüpfung und Discord-Benachrichtigungen), **Aus**
- Die bestätigte Sitzung wird als **nächster Termin** hervorgehoben (am Tag selbst mit Countdown „beginnt in N h M min“)
- Im nativen Modus können Mitglieder zusätzlich **verspätete Ankunft / frühes Gehen** als Uhrzeit (HH:MM) eintragen; sie erscheint neben dem Symbol (`21:30〜`) und im Discord-Bestätigungspost neben dem Namen
- Discord-Vorlagen unterstützen `{discord_relative}` / `{discord_time}` (Discord rendert sie in der Zeitzone des Lesers, z. B. „in 3 Stunden“)
- Automatische Erinnerung per @mention an Mitglieder ohne Antwort; optional automatische Bestätigung, wenn alle geantwortet haben
- Kommentar pro Mitglied per Hover / Tipp; Link zu Google Kalender pro Sitzung

### Inhalte (Kategorien)
- Pro Raid-Inhalt ein **Status** (Nicht begonnen / In Arbeit / Geschafft / Pausiert), Drag-and-Drop-Sortierung, Bearbeitungsdialog, Echtzeit-Sync über Supabase Realtime

### Unter-Tabs pro Inhalt
- **Mitigation / Loot**: bestehende Google-Sheets als iframe; **auf dem Handy eine schreibgeschützte Kartenansicht** (Sheet als CSV geladen, Karten pro Phase, Filter „nur meine Spalte“). Der Loot-Tab ergänzt den **wöchentlichen Abhol-Check** (Reset Dienstag 17:00 JST) und **BiS-Links** (XivGear-Einbettung)
- **Guides**: Linkliste mit automatischem Titel; **Videos**: YouTube-Vorschau mit Lazy-Embed, optional FFLogs-/XIVAnalysis-Link
- **Makros**: Spielmakros mit Ein-Klick-Kopie; dazu **Waymark-Presets** (markercode) und **Strategy-Board-Share-Codes**
- **Übungs-Log**: Pull-für-Pull-Daten aus FFLogs — Gesamt-Pulls, Übungstage, tiefster Fortschritt, Clears; Fortschrittsbalken pro Tag; pro Pull ein Klick zu FFLogs / XIVAnalysis / dem Moment im Video; **Wipe-Ursache** pro Pull (Job, der zuerst starb ← tödliche Fähigkeit, Tode innerhalb 10 s) und Auswertung, welche Mechanik die Gruppe bricht; bei Ultimates **Zeit pro Phase**. Individuelle DPS werden weder gespeichert noch angezeigt; Tode ohne Spielernamen (nur Job + Fähigkeit)

### Discord-Auto-Import
- Pro Inhalt ein Guide- und ein Video-Kanal; Vercel Cron holt täglich um 01:00 JST die letzten 100 Nachrichten, extrahiert URLs, entfernt Duplikate und legt sie im passenden Tab ab. Manueller Sofort-Import per Button

### Themes und Farben
- Sieben Erweiterungs-Themes (ARR bis Evercold) mit eigenen Hintergrundeffekten
- **Farbsemantik in fünf Stufen** (`src/lib/perf-tone.ts`): gut = emerald → lime → amber → orange → rose = schlecht, einheitlich für Rest-HP%, Tode, Fortschrittsbalken, Anwesenheitssymbole und den wöchentlichen Check. Zahlen und Symbole stehen immer daneben

## Technik

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase (Postgres + Realtime, RLS) · shadcn/ui + Base UI · Vercel (Auto-Deploy von `main`, Cron Jobs). Vier Sicherheitsebenen: Discord-OAuth-Gate im Proxy, Rollenbeschränkung pro Seite, Admin-Prüfung in jeder Server Action, RLS in der Datenbank. FFLogs-Tokens werden AES-256-GCM-verschlüsselt gespeichert.

## Einrichtung (Kurzfassung, 30–60 Minuten)

Du brauchst Konten bei GitHub, Supabase (Free), Vercel (Hobby) und dem Discord Developer Portal.

1. **Fork** dieses Repositories — den Repository-Namen unbedingt ändern (z. B. `pandora-raid`)
2. **Supabase-Projekt** anlegen, `supabase/schema.sql` im SQL Editor ausführen, Project URL / anon key / service_role key notieren
3. **Discord Application + Bot** erstellen: Client ID / Client Secret, Bot Token (mit SERVER MEMBERS INTENT und MESSAGE CONTENT INTENT), Server-ID (Guild ID)
4. **Discord ↔ Supabase** verbinden: Redirect `https://<projekt>.supabase.co/auth/v1/callback` bei Discord, Discord-Provider in Supabase mit Client ID / Secret aktivieren
5. **Vercel-Deploy** mit den Umgebungsvariablen `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` (optional: `DISCORD_ADMIN_ROLE_IDS`, `CRON_SECRET`, `FFLOGS_API_KEY`, FFLogs OAuth, `SECRET_ENCRYPTION_KEY`, `YOUTUBE_API_KEY`)
6. **Bot einladen** (Scopes `bot`, Rechte „View Channels“ und „Read Message History“)
7. **Supabase URL Configuration**: Site URL = Vercel-Domain, Redirect URLs `https://<domain>/auth/callback` und `http://localhost:3000/auth/callback`
8. **Erste Einrichtung** im Portal: Terminplan-Quelle wählen, Inhalte anlegen, Sheet-URLs eintragen
9. *(Optional)* Kanal-IDs für den Discord-Import eintragen und dem Bot Leserechte pro Kanal geben
10. *(Optional)* GitHub-Secret `SUPABASE_DB_URL` (Session pooler) setzen, damit `schema.sql` per GitHub Actions automatisch ausgerollt wird

Details zu jedem Schritt, Fehlerbehebung und Schema-Updates: [englische Anleitung](README.en.md#setup-for-your-raid-group).

## Lokale Entwicklung

```bash
npm install
cp .env.local.example .env.local  # Supabase-Schlüssel eintragen
npm run dev
```

## Lizenz

MIT
