// Protezioni per l'endpoint pubblico: anti-SSRF + rate limit + concorrenza.
import dns from "node:dns/promises";
import net from "node:net";

// ---------- anti-SSRF ----------
const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,           // 172.16.0.0/12
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];
const unbracket = (h) => h.replace(/^\[/, "").replace(/\]$/, "");
function isPrivateIp(ipRaw) {
  const ip = unbracket(ipRaw);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return (
      v === "::1" || v === "::" ||
      v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
      v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") ||
      v.startsWith("::ffff:192.168.") || v.startsWith("::ffff:169.254.")
    );
  }
  return PRIVATE_V4.some((re) => re.test(ip));
}

// throwa se l'URL non è pubblico/valido; ritorna l'URL normalizzato
export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw).startsWith("http") ? raw : `https://${raw}`); }
  catch { throw new Error("URL non valido."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Sono ammessi solo indirizzi http e https.");
  const host = unbracket(u.hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost"))
    throw new Error("Gli indirizzi interni non sono consentiti.");
  if (net.isIP(host) && isPrivateIp(host))
    throw new Error("Gli indirizzi IP privati non sono consentiti.");
  let addrs = [];
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new Error("Dominio non raggiungibile."); }
  if (addrs.some((a) => isPrivateIp(a.address)))
    throw new Error("Questo dominio punta a una rete interna: non consentito.");
  return u.href;
}

// blocca a livello di rete i sottocaricamenti verso reti interne — incluso il
// caso DNS-rebinding (dominio pubblico che ri-risolve a 127.0.0.1) ri-risolvendo
// ogni hostname. Cache per hostname per non rifare la lookup ogni volta.
// maxRequests limita pagine "runaway" (DoS via migliaia di sottorisorse).
export async function attachRequestGuard(page, { maxRequests = 1500 } = {}) {
  const cache = new Map();
  let count = 0;
  await page.route("**/*", async (route) => {
    try {
      if (++count > maxRequests) return route.abort();
      const h = unbracket(new URL(route.request().url()).hostname.toLowerCase());
      if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return route.abort();
      if (net.isIP(h)) return isPrivateIp(h) ? route.abort() : route.continue();
      if (cache.has(h)) return cache.get(h) ? route.abort() : route.continue();
      let blocked;
      try {
        const addrs = await dns.lookup(h, { all: true });
        blocked = addrs.some((a) => isPrivateIp(a.address));
      } catch {
        blocked = true; // non risolvibile → blocca per sicurezza
      }
      cache.set(h, blocked);
      return blocked ? route.abort() : route.continue();
    } catch {
      return route.abort();
    }
  });
}

// ---------- rate limit + concorrenza ----------
export function createLimiter({ maxConcurrent = 2, perIpPerMin = 6, maxQueue = 20 } = {}) {
  let active = 0;
  const queue = [];
  const ipHits = new Map();

  // pulizia periodica: evita che la mappa IP cresca all'infinito col tempo
  const pruner = setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of ipHits) if (arr.every((t) => now - t > 60000)) ipHits.delete(ip);
  }, 300000);
  pruner.unref?.();

  function rateOk(ip) {
    const now = Date.now();
    const arr = (ipHits.get(ip) || []).filter((t) => now - t < 60000);
    if (arr.length >= perIpPerMin) { ipHits.set(ip, arr); return false; }
    arr.push(now); ipHits.set(ip, arr);
    return true;
  }
  async function acquire() {
    if (active >= maxConcurrent) {
      if (queue.length >= maxQueue) throw new Error("Server occupato, riprova tra poco.");
      await new Promise((r) => queue.push(r));
    }
    active++;
  }
  function release() {
    active--;
    const next = queue.shift();
    if (next) next();
  }
  return { rateOk, acquire, release };
}
