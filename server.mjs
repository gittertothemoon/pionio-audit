// Pionio Audit — server.
// Locale:  node server.mjs   →   http://localhost:4040
// In produzione (Railway) ascolta su process.env.PORT.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve } from "node:path";
import { launchBrowser } from "./lib/launch.mjs";
import { runAudit } from "./lib/runAudit.mjs";
import { assertPublicUrl, createLimiter } from "./lib/guard.mjs";
import { renderExportCard } from "./lib/exportCard.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4040;
const AUDIT_TIMEOUT_MS = 70000;

// un solo browser condiviso per tutte le richieste
let browser = await launchBrowser();
console.log("Chrome pronto.");

const limiter = createLimiter({ maxConcurrent: 2, perIpPerMin: 6, maxQueue: 20 });

// riciclo del browser: Chromium accumula memoria col tempo (un processo che vive
// per sempre lentamente cresce). Dopo RECYCLE_AFTER usi, alla prima finestra in cui
// non c'è nulla in volo, chiudo e rilancio → azzera il creep senza interrompere nessuno.
const RECYCLE_AFTER = 80;
let browserUses = 0, recycling = false;
async function maybeRecycle() {
  if (recycling || browserUses < RECYCLE_AFTER || limiter.activeCount() > 0) return;
  recycling = true;
  const old = browser;
  try {
    browser = await launchBrowser();
    browserUses = 0;
    await old.close().catch(() => {});
    console.log("♻ browser riciclato.");
  } catch (e) {
    console.error("  riciclo browser fallito:", e.message);
  } finally {
    recycling = false;
  }
}
const MIME = { ".ttf": "font/ttf", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".js": "text/javascript; charset=utf-8" };

// cache risultati: stesso URL ri-analizzato entro 10 min → risposta istantanea, niente Chrome
const CACHE_TTL = 10 * 60 * 1000;
const auditCache = new Map();
const clientIp = (req) => (req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "?";

// script esterno → CSP senza 'unsafe-inline' sugli script (vero scudo anti-XSS)
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cloud.umami.is; font-src 'self'; connect-src 'self' https://cloud.umami.is https://api-gateway.umami.dev; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const PUBLIC = resolve(join(__dir, "public"));
async function serveStatic(res, file) {
  const full = resolve(file);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + "/")) { // anti path-traversal
    res.writeHead(403); return res.end("forbidden");
  }
  const buf = await readFile(full);
  res.writeHead(200, { "content-type": MIME[extname(full)] || "application/octet-stream", ...SECURITY_HEADERS });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);

    // healthcheck per Railway: 200 solo se il browser è vivo → se si è impallato,
    // Railway lo vede e riavvia il servizio invece di servire errori.
    if (u.pathname === "/health") {
      const ok = !!browser && browser.isConnected();
      res.writeHead(ok ? 200 : 503, { "content-type": "text/plain" });
      return res.end(ok ? "ok" : "browser down");
    }

    if (u.pathname === "/") return serveStatic(res, join(__dir, "public", "index.html"));
    if (u.pathname === "/app.js") return serveStatic(res, join(__dir, "public", "app.js"));
    if (u.pathname.startsWith("/fonts/")) return serveStatic(res, join(__dir, "public", "fonts", u.pathname.replace("/fonts/", "")));
    if (u.pathname.startsWith("/brand/")) return serveStatic(res, join(__dir, "public", "brand", u.pathname.replace("/brand/", "")));

    if (u.pathname === "/api/audit" && req.method === "POST") {
      const ip = clientIp(req);
      if (!limiter.rateOk(ip)) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Troppe analisi in poco tempo. Aspetta un minuto e riprova." }));
      }
      const JSON_HEAD = { "content-type": "application/json", "x-content-type-options": "nosniff" };
      let body = "";
      let tooBig = false;
      req.on("data", (c) => {
        body += c;
        if (body.length > 2048 && !tooBig) {
          tooBig = true;
          res.writeHead(413, JSON_HEAD);
          res.end(JSON.stringify({ error: "Richiesta troppo grande." }));
          req.destroy();
        }
      });
      req.on("end", async () => {
        if (tooBig) return;
        let slot = false;
        try {
          const { url } = JSON.parse(body || "{}");
          if (!url) throw new Error("URL mancante.");
          const safeUrl = await assertPublicUrl(url);   // anti-SSRF
          const hit = auditCache.get(safeUrl);
          if (hit && Date.now() - hit.ts < CACHE_TTL) { // cache → niente Chrome
            res.writeHead(200, JSON_HEAD);
            return res.end(JSON.stringify(hit.data));
          }
          await limiter.acquire(); slot = true;          // tetto concorrenza
          console.log(`→ audit [${ip}]: ${safeUrl}`);
          const data = await Promise.race([
            runAudit(safeUrl, browser, { guardRequests: true }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("L'analisi ha impiegato troppo. Riprova.")), AUDIT_TIMEOUT_MS)),
          ]);
          auditCache.set(safeUrl, { data, ts: Date.now() });
          if (auditCache.size > 300) auditCache.delete(auditCache.keys().next().value);
          res.writeHead(200, JSON_HEAD);
          res.end(JSON.stringify(data));
        } catch (e) {
          console.error("  errore:", e.message);
          res.writeHead(400, JSON_HEAD);
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          if (slot) { browserUses++; limiter.release(); maybeRecycle(); }
        }
      });
      return;
    }

    if (u.pathname === "/api/export" && req.method === "POST") {
      const ip = clientIp(req);
      const JSON_HEAD = { "content-type": "application/json", "x-content-type-options": "nosniff" };
      if (!limiter.rateOk(ip)) {
        res.writeHead(429, JSON_HEAD);
        return res.end(JSON.stringify({ error: "Troppe richieste. Aspetta un minuto." }));
      }
      let body = "";
      let tooBig = false;
      req.on("data", (c) => {
        body += c;
        if (body.length > 4_000_000 && !tooBig) {
          tooBig = true;
          res.writeHead(413, JSON_HEAD);
          res.end(JSON.stringify({ error: "Dati troppo grandi." }));
          req.destroy();
        }
      });
      req.on("end", async () => {
        if (tooBig) return;
        let slot = false;
        try {
          const data = JSON.parse(body || "{}");
          await limiter.acquire(); slot = true;
          const png = await renderExportCard(browser, data);
          const safeName = (data.host || "report").replace(/[^a-z0-9.-]/gi, "_");
          res.writeHead(200, {
            "content-type": "image/png",
            "content-disposition": `attachment; filename="pionio-audit-${safeName}.png"`,
            ...SECURITY_HEADERS,
          });
          res.end(png);
        } catch (e) {
          console.error("  export errore:", e.message);
          res.writeHead(400, JSON_HEAD);
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          if (slot) { browserUses++; limiter.release(); maybeRecycle(); }
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Pionio Audit → http://localhost:${PORT}`));
