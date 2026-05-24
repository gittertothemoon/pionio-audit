// Pionio Audit — v1 grezzo
// Incolli un URL, ti restituisce performance + screenshot + problemi concreti
// scritti con la voce Pionio (conseguenza di business, non numeri secchi).
//
// Uso:  node audit.mjs https://esempio.it
// Output: report/<host>.html  (+ screenshot embedded) e un riassunto in console.

import { launchBrowser } from "./lib/launch.mjs";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL = "/Users/ivanpanto/.claude/skills/pionio-design";

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error("Uso: node audit.mjs <url>");
  process.exit(1);
}
const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
const host = new URL(url).host;

// ---------- raccolta metriche ----------
const browser = await launchBrowser();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 PionioAudit/0.1",
});
const page = await ctx.newPage();

// LCP e CLS si catturano solo con observer registrati PRIMA del load
await page.addInitScript(() => {
  window.__lcp = 0;
  window.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      const es = list.getEntries();
      window.__lcp = es[es.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
});

let transferBytes = 0;
let requests = 0;
let imgBytes = 0;
const resp = [];
page.on("response", async (r) => {
  requests++;
  try {
    const len = Number(r.headers()["content-length"] || 0);
    transferBytes += len;
    const type = r.request().resourceType();
    if (type === "image") imgBytes += len;
    resp.push({ url: r.url(), status: r.status(), type, len });
  } catch {}
});

const t0 = Date.now();
let httpStatus = 0;
try {
  const nav = await page.goto(url, { waitUntil: "load", timeout: 45000 });
  httpStatus = nav ? nav.status() : 0;
} catch (e) {
  console.error("Errore nel caricamento:", e.message);
}
// lascia stabilizzare LCP / lazy content
await page.waitForTimeout(2500);

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const paint = performance.getEntriesByType("paint");
  const fcp = paint.find((p) => p.name === "first-contentful-paint");

  // LCP / CLS raccolti dagli observer registrati a init time
  const lcp = window.__lcp || 0;
  const cls = window.__cls || 0;

  const imgs = [...document.images];
  const noAltImgs = imgs.filter((i) => !i.alt || !i.alt.trim()).length;
  const lazyImgs = imgs.filter((i) => i.loading === "lazy").length;

  const headScripts = [...document.head.querySelectorAll("script[src]")].filter(
    (s) => !s.async && !s.defer
  ).length;
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"]').length;

  const viewport = !!document.querySelector('meta[name="viewport"]');
  const desc = document.querySelector('meta[name="description"]');
  const ogImage = !!document.querySelector('meta[property="og:image"]');
  const favicon = !!document.querySelector('link[rel~="icon"]');
  const h1 = document.querySelectorAll("h1").length;
  const lang = document.documentElement.lang || "";
  const title = document.title || "";

  return {
    ttfb: nav.responseStart || 0,
    domContentLoaded: nav.domContentLoadedEventEnd || 0,
    load: nav.loadEventEnd || 0,
    fcp: fcp ? fcp.startTime : 0,
    lcp,
    cls,
    domNodes: document.querySelectorAll("*").length,
    imgCount: imgs.length,
    noAltImgs,
    lazyImgs,
    headScripts,
    stylesheets,
    viewport,
    hasDesc: !!desc,
    descLen: desc ? (desc.content || "").length : 0,
    ogImage,
    favicon,
    h1,
    lang,
    title,
    titleLen: title.length,
  };
});

const screenshotPath = join(__dir, "report", `${host}.png`);
mkdirSync(join(__dir, "report"), { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: false });
const isHttps = url.startsWith("https://");
await browser.close();

// ---------- scoring + traduzione in voce Pionio ----------
// soglie ispirate ai Core Web Vitals di Google (oneste, non inventate)
const ms = (n) => Math.round(n);
const sec = (n) => (n / 1000).toFixed(1);
const kb = (n) => Math.round(n / 1024);

const findings = []; // {sev: 'critico'|'attenzione'|'ok', titolo, dettaglio}
const add = (sev, titolo, dettaglio) => findings.push({ sev, titolo, dettaglio });

// LCP — il numero che pesa di più sul "mi fido / me ne vado"
if (metrics.lcp > 4000)
  add(
    "critico",
    `Il contenuto principale compare dopo ${sec(metrics.lcp)} secondi`,
    `Google considera lento tutto sopra i 2,5s. A ${sec(metrics.lcp)}s una fetta grossa di chi arriva chiude prima ancora di vedere di cosa parli. È il problema che ti costa più clienti, in silenzio.`
  );
else if (metrics.lcp > 2500)
  add(
    "attenzione",
    `Il contenuto principale compare in ${sec(metrics.lcp)} secondi`,
    `Sei oltre la soglia dei 2,5s che Google usa come riga di confine. Non è un disastro, ma su mobile e connessioni lente si sente: è la differenza tra "veloce" e "ci pensa".`
  );
else
  add("ok", `Il contenuto principale compare in ${sec(metrics.lcp)}s`, `Sotto la soglia. Qui sei a posto.`);

// peso pagina
if (transferBytes > 3_000_000)
  add(
    "critico",
    `La pagina pesa ${(transferBytes / 1e6).toFixed(1)} MB`,
    `Su uno smartphone in 4G questo si traduce in attesa e dati consumati. Le pagine che convertono stanno quasi sempre sotto 1,5 MB. Quasi sempre il colpevole sono le immagini non ottimizzate.`
  );
else if (transferBytes > 1_500_000)
  add(
    "attenzione",
    `La pagina pesa ${(transferBytes / 1e6).toFixed(1)} MB`,
    `Sopra la soglia comoda di 1,5 MB. Margine di alleggerimento c'è, soprattutto sulle immagini (${kb(imgBytes)} KB solo di immagini).`
  );

// immagini
if (imgBytes > 1_000_000)
  add(
    "attenzione",
    `${kb(imgBytes)} KB di sole immagini`,
    `Convertendole in formato moderno (WebP/AVIF) e dimensionandole giuste qui si recupera quasi sempre più di metà del peso. È la leva con il miglior rapporto fatica/risultato.`
  );

// CLS — la pagina che "salta"
if (metrics.cls > 0.1)
  add(
    "attenzione",
    `Il layout si sposta mentre carica (CLS ${metrics.cls.toFixed(2)})`,
    `Gli elementi ballano durante il caricamento: chi sta per cliccare clicca la cosa sbagliata. Dà una sensazione di sito "non finito" anche quando il design è curato.`
  );

// render-blocking
if (metrics.headScripts > 0)
  add(
    "attenzione",
    `${metrics.headScripts} script bloccano il primo render`,
    `Sono nel <head> senza async/defer: il browser si ferma ad aspettarli prima di disegnare la pagina. Spostarli o renderli differiti accorcia l'attesa percepita.`
  );

// HTTPS
if (!isHttps)
  add(
    "critico",
    `Il sito non è su HTTPS`,
    `Il browser mostra "Non sicuro" nella barra. Nel 2026 è il primo motivo per cui un visitatore se ne va in due secondi. Va sistemato prima di tutto il resto.`
  );

// SEO / social di base
if (!metrics.title || metrics.titleLen < 10)
  add("critico", `Manca un titolo della pagina decente`, `Il <title> è ciò che appare su Google e nei tab. Vuoto o troppo corto = invisibile nella ricerca.`);
if (!metrics.hasDesc)
  add(
    "attenzione",
    `Manca la meta description`,
    `È il testo sotto al titolo nei risultati Google. Senza, Google se lo inventa — di solito male. Due righe scritte bene alzano i click a parità di posizione.`
  );
if (!metrics.ogImage)
  add(
    "attenzione",
    `Manca l'immagine di anteprima social (og:image)`,
    `Quando qualcuno condivide il link su WhatsApp/LinkedIn esce un riquadro vuoto e grigio. Un'anteprima curata fa la differenza tra un link cliccato e uno ignorato.`
  );
if (metrics.h1 === 0)
  add("attenzione", `Nessun titolo H1 nella pagina`, `Google usa l'H1 per capire di cosa parli. Senza, deve indovinare.`);
else if (metrics.h1 > 1)
  add("attenzione", `${metrics.h1} titoli H1 nella stessa pagina`, `Dovrebbe essercene uno solo: più H1 confondono i motori su qual è il messaggio principale.`);
if (!metrics.lang)
  add("attenzione", `Manca la lingua del sito (lang)`, `Senza l'attributo lang, screen reader e Google non sanno che il sito è in italiano.`);
if (metrics.noAltImgs > 0)
  add(
    "attenzione",
    `${metrics.noAltImgs} immagini senza testo alternativo`,
    `Sono invisibili a chi usa screen reader e a Google Immagini. Accessibilità e SEO nello stesso colpo.`
  );

// punteggio: parte da 100, pesa le severità
let score = 100;
for (const f of findings) {
  if (f.sev === "critico") score -= 18;
  else if (f.sev === "attenzione") score -= 7;
}
score = Math.max(5, Math.min(100, score));
const grade = score >= 90 ? "Solido" : score >= 70 ? "Buono, con margini" : score >= 50 ? "Da sistemare" : "Critico";

// verdetto in voce Pionio
const critici = findings.filter((f) => f.sev === "critico").length;
const verdetto =
  critici > 0
    ? `${critici === 1 ? "C'è 1 cosa che ti sta" : `Ci sono ${critici} cose che ti stanno`} costando visitatori adesso. Niente che richieda di rifare il sito: si sistemano una per una.`
    : score >= 90
    ? `Il sito è in salute. I dettagli sotto sono rifiniture, non emergenze.`
    : `Niente di rotto, ma diversi punti dove con poco lavoro guadagni velocità e fiducia.`;

// ---------- report HTML brandizzato ----------
const css = readFileSync(join(SKILL, "colors_and_type.css"), "utf8")
  // riscrivo i path font assoluti così il report si vede bene aperto da solo
  .replaceAll("url('fonts/", `url('file://${SKILL}/fonts/`);
const pmarkB64 = `data:image/png;base64,${readFileSync(join(SKILL, "assets", "pionio-p-mark.png")).toString("base64")}`;

const sevDot = { critico: "var(--danger)", attenzione: "#e0b341", ok: "var(--accent-400)" };
const sevLabel = { critico: "CRITICO", attenzione: "DA GUARDARE", ok: "OK" };

// screenshot in base64 per un file unico e portabile
const shotB64 = existsSync(screenshotPath)
  ? `data:image/png;base64,${readFileSync(screenshotPath).toString("base64")}`
  : "";

const findingsHtml = findings
  .map(
    (f) => `
    <div class="finding">
      <div class="dot" style="background:${sevDot[f.sev]}"></div>
      <div class="fbody">
        <div class="ftop"><span class="ftag" style="color:${sevDot[f.sev]}">${sevLabel[f.sev]}</span></div>
        <h3 class="t-h3 ftitle">${f.titolo}</h3>
        <p class="t-body fdetail">${f.dettaglio}</p>
      </div>
    </div>`
  )
  .join("");

const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit Pionio — ${host}</title>
<style>${css}
  * { margin:0; box-sizing:border-box; }
  body { padding: var(--s-9) var(--s-6); max-width: 920px; margin: 0 auto; }
  .eyebrow-row { display:flex; align-items:center; gap: var(--s-3); margin-bottom: var(--s-5); }
  .pmark { width:34px; height:34px; object-fit:contain; filter:drop-shadow(0 2px 8px rgba(0,0,0,.5)); }
  .hero { display:grid; grid-template-columns: 1.1fr 1fr; gap: var(--s-7); align-items:center;
          padding: var(--s-7); background: var(--surface-2); border:1px solid var(--border-2);
          border-radius: var(--r-xl); margin-bottom: var(--s-7); }
  .score { font-family:var(--font-sans); font-weight:500; font-size: 5.5rem; line-height:1;
           letter-spacing:-0.03em; color: var(--fg-1); }
  .score small { font-size: 1.4rem; color: var(--fg-3); }
  .grade { margin-top: var(--s-3); }
  .shot { width:100%; border-radius: var(--r-md); border:1px solid var(--border-2);
          box-shadow: var(--shadow-2); display:block; }
  .verdetto { padding: var(--s-5) var(--s-6); border-left: 2px solid var(--accent-600);
              background: var(--accent-950); border-radius: 0 var(--r-md) var(--r-md) 0;
              margin-bottom: var(--s-8); }
  .findings { display:flex; flex-direction:column; gap: var(--s-2); }
  .finding { display:flex; gap: var(--s-4); padding: var(--s-5) var(--s-5);
             border:1px solid var(--border-1); border-radius: var(--r-md); background: var(--surface-1); }
  .dot { width:10px; height:10px; border-radius:50%; margin-top: 7px; flex:none; }
  .ftag { font-family:var(--font-mono); font-size: var(--t-micro); letter-spacing: var(--tr-widest); }
  .ftitle { margin: 4px 0 6px; }
  .fdetail { color: var(--fg-2); }
  .cta { margin-top: var(--s-9); padding: var(--s-8); text-align:center;
         background: var(--surface-2); border:1px solid var(--border-2); border-radius: var(--r-xl); }
  .cta a { color: var(--accent-400); text-decoration:none; font-weight:500; }
  .footer { margin-top: var(--s-7); text-align:center; }
</style></head>
<body>
  <div class="eyebrow-row">
    <img class="pmark" src="${pmarkB64}">
    <span class="t-eyebrow">AUDIT ISTANTANEO</span>
  </div>

  <div class="hero">
    <div>
      <div class="score">${score}<small>/100</small></div>
      <div class="grade t-h3" style="color:${score >= 70 ? "var(--accent-400)" : "#e0b341"}">${grade}</div>
      <p class="t-url" style="margin-top:var(--s-4)">${url}</p>
    </div>
    ${shotB64 ? `<img class="shot" src="${shotB64}" alt="${host}">` : ""}
  </div>

  <div class="verdetto">
    <span class="t-eyebrow t-eyebrow--accent">IL VERDETTO</span>
    <p class="t-body-lg" style="margin-top:var(--s-2); color:var(--fg-1)">${verdetto}</p>
  </div>

  <div class="findings">${findingsHtml}</div>

  <div class="cta">
    <span class="t-eyebrow">E ADESSO?</span>
    <h2 class="t-h2" style="margin:var(--s-3) 0">Questi problemi si sistemano.<br>Vuoi che lo facciamo noi?</h2>
    <p class="t-body" style="margin-bottom:var(--s-5)">Nessun preventivo infinito. Scope chiuso, prezzo fisso.</p>
    <a class="t-body-lg" href="https://pionio.it">→ pionio.it</a>
  </div>

  <div class="footer">
    <span class="t-caption">Generato da Pionio Audit · misurazioni reali via Chrome · ${new Date().toLocaleDateString("it-IT")}</span>
  </div>
</body></html>`;

const reportPath = join(__dir, "report", `${host}.html`);
writeFileSync(reportPath, html);

// dati grezzi → alimentano la card condivisibile e (domani) i contenuti social
const dataPath = join(__dir, "report", `${host}.json`);
writeFileSync(
  dataPath,
  JSON.stringify(
    {
      url,
      host,
      httpStatus,
      score,
      grade,
      verdetto,
      metrics,
      transferBytes,
      requests,
      imgBytes,
      findings,
      shotB64,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  )
);

// ---------- riassunto console ----------
console.log(`\n  PIONIO AUDIT — ${host}`);
console.log(`  ${"─".repeat(46)}`);
console.log(`  Punteggio: ${score}/100  (${grade})   [HTTP ${httpStatus}]`);
console.log(`  LCP ${sec(metrics.lcp)}s · FCP ${sec(metrics.fcp)}s · TTFB ${ms(metrics.ttfb)}ms · CLS ${metrics.cls.toFixed(2)}`);
console.log(`  Peso ${(transferBytes / 1e6).toFixed(1)} MB · ${requests} richieste · ${metrics.imgCount} immagini · ${metrics.domNodes} nodi DOM`);
console.log(`  ${"─".repeat(46)}`);
console.log(`  ${verdetto}\n`);
for (const f of findings) {
  const tag = { critico: "✕ CRITICO  ", attenzione: "! GUARDA   ", ok: "✓ OK       " }[f.sev];
  console.log(`  ${tag} ${f.titolo}`);
}
console.log(`\n  Report visivo → ${reportPath}`);
console.log(`  (apri con:  open "${reportPath}")\n`);
