# Check-in App

Minimalistische Check-in App für zwei User (Kastri und Thomas). Die Oberfläche
ist statisch, Schreibzugriffe laufen über eine kleine Serverless API. Benutzer
brauchen keinen GitHub Token im Browser.

## Regeln

- Mindestens 5x pro Woche einchecken
- Mindestens 1 Stunde pro Tag (mehrere Sessions möglich)
- Tracker startet bei Check-in, läuft bis Check-out
- Beim Check-out kurzer Kommentar was gemacht wurde
- Dashboard zeigt Wochenübersicht für beide User

## Setup

1. Repo `kastriasani-gif/checkin-app` (public)
2. Deployment auf Vercel, damit `/api/sessions` verfügbar ist
3. Kastri legt einmalig einen **Fine-grained PAT** für den Server an:
   - https://github.com/settings/personal-access-tokens/new
   - Repository access: Only `kastriasani-gif/checkin-app`
   - Permissions: `Contents: Read and write`
4. In Vercel als Environment Variable setzen:
   - `GITHUB_TOKEN`: der Fine-grained PAT
   - optional `ALLOWED_ORIGINS`: kommagetrennte erlaubte Origins, z.B.
     `https://checkin-app.vercel.app,https://kastriasani-gif.github.io`

Wenn die App weiter auf GitHub Pages laufen soll, muss vor `app.js` ein
`window.CHECKIN_API_URL` gesetzt werden, das auf die Vercel Function zeigt.
Am einfachsten ist aber, die App direkt über Vercel zu öffnen.

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
