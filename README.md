# Pionio Audit

![Pionio Audit](public/brand/og.jpg)

An **instant website audit** tool: give it a URL and in a few seconds it measures
the site on **mobile and desktop** with headless Chromium, returning a graduated
score with advice written in plain human language. Built as a free lead-gen tool
for [Pionio](https://pionio.it).

A single engine (`lib/runAudit.mjs`) is shared between the **web server** and the
**CLI**, so scores and tone are identical everywhere.

## Features

- **Dual measurement** — mobile (390×844) + desktop (1600×900) with real Chrome
  user agents, so anti-bot walls don't block the audit.
- **Graduated scoring** + technical errors translated into understandable
  messages (DNS, SSL, timeout, crash…).
- **Hardened server** (`server.mjs`):
  - anti-SSRF: blocks `localhost` and private IPs (`lib/guard.mjs`)
  - rate limiting per IP (6/min), max 2 concurrent audits, queue, 70s timeout
  - CSP with no `unsafe-inline` on scripts, `X-Frame-Options: DENY`, `nosniff`
  - **a single shared browser** with periodic recycling to contain Chromium's
    memory creep
  - result caching (same URL within 10 min → instant response)
- **Shareable social card** (IG 1080×1350 / X 1600×900) from the result.
- **No heavy dependencies** — only `playwright-core`; fonts and logo served from
  `public/`.

## Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js (ESM, native `http`, no framework) |
| Browser automation | Playwright (`playwright-core`) + Chromium |
| Deploy | Docker (official Playwright image) on Railway |

## Usage

### Web server

```bash
npm start            # http://localhost:4040
```

In production it listens on `process.env.PORT` (injected by Railway).

### CLI

```bash
npm run audit https://example.com   # writes HTML + JSON report to report/
npm run card  example.com           # builds the social card from the report
```

### Docker

```bash
docker build -t pionio-audit .
docker run -p 4040:4040 pionio-audit
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4040` | Server port (Railway injects it) |
| `PW_CHANNEL` | `chrome` locally, bundled in container | Playwright browser channel |
| `PIONIO_SKILL_DIR` | `./brand` | Folder with brand assets (CSS + fonts + p-mark) used by the CLI card |

> The CLI card (`audit.mjs` / `card.mjs`) uses Pionio brand assets that live
> outside the repo: point `PIONIO_SKILL_DIR` at the folder that holds them. The
> **web server** is self-contained (`lib/exportCard.mjs` + `public/`).

## Structure

```
server.mjs          # HTTP server: routing, security, cache, browser recycling
audit.mjs           # CLI: single audit → HTML+JSON in report/
card.mjs            # CLI: social card from a report
lib/
├── runAudit.mjs    # measurement + scoring engine (shared)
├── launch.mjs      # browser launch
├── guard.mjs       # anti-SSRF + rate limiter
└── exportCard.mjs  # server-side card
public/             # static frontend, fonts, brand
Dockerfile          # Playwright image for Railway
```

See `DEPLOY.md` for the Railway deploy procedure with a custom domain.
