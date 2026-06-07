# Pionio Audit

Tool di **audit istantaneo di un sito**: dai un URL, in pochi secondi misura il
sito su **mobile e desktop** con Chromium headless e restituisce un punteggio
graduato con consigli scritti in linguaggio umano. Pensato come strumento
gratuito di lead-gen per [Pionio](https://pionio.it).

Motore unico (`lib/runAudit.mjs`) condiviso tra **server web** e **CLI**, così
punteggi e tono sono identici ovunque.

## Caratteristiche

- **Doppia misura** mobile (390×844) + desktop (1600×900) con UA Chrome reali
  per non farsi bloccare dai muri anti-bot.
- **Scoring graduato** + messaggi di errore tradotti in linguaggio comprensibile
  (DNS, SSL, timeout, crash…).
- **Hardening del server** (`server.mjs`):
  - anti-SSRF: blocca `localhost` e IP privati (`lib/guard.mjs`)
  - rate limit per IP (6/min), max 2 analisi concorrenti, coda, timeout 70s
  - CSP senza `unsafe-inline` sugli script, `X-Frame-Options: DENY`, `nosniff`
  - **un solo browser condiviso** con riciclo periodico per contenere il
    memory-creep di Chromium
  - cache dei risultati (stesso URL entro 10 min → risposta istantanea)
- **Card social esportabile** (IG 1080×1350 / X 1600×900) dal risultato.
- **Zero dipendenze pesanti**: solo `playwright-core`; font e logo serviti da
  `public/`.

## Stack

| Ambito | Tecnologia |
| --- | --- |
| Runtime | Node.js (ESM, `http` nativo, nessun framework) |
| Browser automation | Playwright (`playwright-core`) + Chromium |
| Deploy | Docker (immagine ufficiale Playwright) su Railway |

## Uso

### Server web

```bash
npm start            # http://localhost:4040
```

In produzione ascolta su `process.env.PORT` (iniettata da Railway).

### CLI

```bash
npm run audit https://esempio.it   # scrive report HTML + JSON in report/
npm run card  esempio.it           # genera la card social dal report
```

### Docker

```bash
docker build -t pionio-audit .
docker run -p 4040:4040 pionio-audit
```

## Configurazione

| Variabile | Default | Scopo |
| --- | --- | --- |
| `PORT` | `4040` | Porta del server (Railway la inietta) |
| `PW_CHANNEL` | `chrome` in locale, bundled in container | Canale browser di Playwright |
| `PIONIO_SKILL_DIR` | `./brand` | Cartella con gli asset di brand (CSS + font + p-mark) usati dalla card CLI |

> La card CLI (`audit.mjs` / `card.mjs`) usa asset di brand Pionio esterni al
> repo: punta `PIONIO_SKILL_DIR` alla cartella che li contiene. Il **server web**
> è invece self-contained (`lib/exportCard.mjs` + `public/`).

## Struttura

```
server.mjs          # server HTTP: routing, sicurezza, cache, riciclo browser
audit.mjs           # CLI: audit singolo → report/ HTML+JSON
card.mjs            # CLI: card social da un report
lib/
├── runAudit.mjs    # motore di misura e scoring (condiviso)
├── launch.mjs      # avvio browser
├── guard.mjs       # anti-SSRF + rate limiter
└── exportCard.mjs  # card lato server
public/             # frontend statico, font, brand
Dockerfile          # immagine Playwright per Railway
```

Vedi `DEPLOY.md` per la procedura di deploy su Railway con dominio custom.
