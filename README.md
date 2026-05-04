# Check-in App

Minimalistische Check-in App für zwei User (Kastri und Thomas). Statisch auf
GitHub Pages, Daten in `data.json` über die GitHub Contents API.

## Regeln

- Mindestens 5x pro Woche einchecken
- Mindestens 1 Stunde pro Tag (mehrere Sessions möglich)
- Tracker startet bei Check-in, läuft bis Check-out
- Beim Check-out kurzer Kommentar was gemacht wurde
- Dashboard zeigt Wochenübersicht für beide User

## Setup

1. Repo `kastriasani-gif/checkin-app` (public)
2. GitHub Pages aus `main` Branch root
3. Kastri legt einmalig einen **Fine-grained PAT** an:
   - https://github.com/settings/personal-access-tokens/new
   - Repository access: Only `kastriasani-gif/checkin-app`
   - Permissions: `Contents: Read and write`
   - In der App: "Token" unten rechts → einfügen → Speichern
4. Für Thomas: in der App auf "Token" → "Setup-Link kopieren" → den Link an
   Thomas schicken. Beim Öffnen des Links wird der Token in seinem Browser
   automatisch gespeichert.

## Lokal testen

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Datenmodell

```json
{
  "sessions": [
    {
      "id": "uuid",
      "user": "kastri",
      "started_at": "2026-05-04T08:30:00Z",
      "ended_at": "2026-05-04T09:15:00Z",
      "comment": "Was gemacht wurde"
    }
  ]
}
```
