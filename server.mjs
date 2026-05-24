// Pionio Audit — server.
// Locale:  node server.mjs   →   http://localhost:4040
// In produzione (Railway) ascolta su process.env.PORT.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { launchBrowser } from "./lib/launch.mjs";
import { runAudit } from "./lib/runAudit.mjs";
import { assertPublicUrl, createLimiter } from "./lib/guard.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4040;
const AUDIT_TIMEOUT_MS = 70000;

// un solo browser condiviso per tutte le richieste
const browser = await launchBrowser();
console.log("Chrome pronto.");

const limiter = createLimiter({ maxConcurrent: 2, perIpPerMin: 6, maxQueue: 20 });
const MIME = { ".ttf": "font/ttf", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const clientIp = (req) => (req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "?";

async function serveStatic(res, file) {
  const buf = await readFile(file);
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);

    if (u.pathname === "/") return serveStatic(res, join(__dir, "public", "index.html"));
    if (u.pathname.startsWith("/fonts/")) return serveStatic(res, join(__dir, "public", "fonts", u.pathname.replace("/fonts/", "")));
    if (u.pathname.startsWith("/brand/")) return serveStatic(res, join(__dir, "public", "brand", u.pathname.replace("/brand/", "")));

    if (u.pathname === "/api/audit" && req.method === "POST") {
      const ip = clientIp(req);
      if (!limiter.rateOk(ip)) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Troppe analisi in poco tempo. Aspetta un minuto e riprova." }));
      }
      let body = "";
      let tooBig = false;
      req.on("data", (c) => { body += c; if (body.length > 2048) { tooBig = true; req.destroy(); } });
      req.on("end", async () => {
        if (tooBig) return;
        let slot = false;
        try {
          const { url } = JSON.parse(body || "{}");
          if (!url) throw new Error("URL mancante.");
          const safeUrl = await assertPublicUrl(url);   // anti-SSRF
          await limiter.acquire(); slot = true;          // tetto concorrenza
          console.log(`→ audit [${ip}]: ${safeUrl}`);
          const data = await Promise.race([
            runAudit(safeUrl, browser, { guardRequests: true }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("L'analisi ha impiegato troppo. Riprova.")), AUDIT_TIMEOUT_MS)),
          ]);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(data));
        } catch (e) {
          console.error("  errore:", e.message);
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          if (slot) limiter.release();
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
