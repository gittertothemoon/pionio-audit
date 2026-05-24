// Protezioni per l'endpoint pubblico: anti-SSRF + rate limit + concorrenza.
import dns from "node:dns/promises";
import net from "node:net";

// ---------- anti-SSRF ----------
const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,           // 172.16.0.0/12
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];
function isPrivateIp(ip) {
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
  const host = u.hostname.toLowerCase();
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

// blocca a livello di rete i sottocaricamenti verso IP privati (es. redirect → 169.254.169.254)
export async function attachRequestGuard(page) {
  await page.route("**/*", (route) => {
    try {
      const h = new URL(route.request().url()).hostname.toLowerCase();
      if (h === "localhost" || (net.isIP(h) && isPrivateIp(h))) return route.abort();
    } catch {}
    return route.continue();
  });
}

// ---------- rate limit + concorrenza ----------
export function createLimiter({ maxConcurrent = 2, perIpPerMin = 6, maxQueue = 20 } = {}) {
  let active = 0;
  const queue = [];
  const ipHits = new Map();

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
