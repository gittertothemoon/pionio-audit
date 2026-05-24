// Motore dell'audit — misura + scoring + traduzione in voce Pionio.
// Riusato sia dalla CLI (audit.mjs) sia dal server web (server.mjs).
// Non scrive file: restituisce solo i dati.

import { attachRequestGuard } from "./guard.mjs";

export async function runAudit(rawUrl, browser, opts = {}) {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const host = new URL(url).host;
  const isHttps = url.startsWith("https://");

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 PionioAudit/0.1",
  });
  const page = await ctx.newPage();
  if (opts.guardRequests) await attachRequestGuard(page);

  // peso REALE: byte effettivamente scaricati, letti dal DevTools Protocol
  // (non più la somma degli header content-length, che molti siti non mandano)
  let transferBytes = 0;
  let imgBytes = 0;
  let requests = 0;
  const reqType = new Map();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", () => requests++);
  cdp.on("Network.responseReceived", (e) => reqType.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => {
    const len = e.encodedDataLength || 0;
    transferBytes += len;
    if (reqType.get(e.requestId) === "Image") imgBytes += len;
  });

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

  let httpStatus = 0;
  try {
    const nav = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    httpStatus = nav ? nav.status() : 0;
  } catch (e) {
    await ctx.close();
    throw new Error(`Non riesco a caricare ${url}: ${e.message}`);
  }
  await page.waitForTimeout(2500);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((p) => p.name === "first-contentful-paint");
    const lcp = window.__lcp || 0;
    const cls = window.__cls || 0;
    const imgs = [...document.images];
    const noAltImgs = imgs.filter((i) => !i.alt || !i.alt.trim()).length;
    const headScripts = [...document.head.querySelectorAll("script[src]")].filter(
      (s) => !s.async && !s.defer
    ).length;
    const desc = document.querySelector('meta[name="description"]');
    return {
      ttfb: nav.responseStart || 0,
      fcp: fcp ? fcp.startTime : 0,
      lcp,
      cls,
      domNodes: document.querySelectorAll("*").length,
      imgCount: imgs.length,
      noAltImgs,
      headScripts,
      viewport: !!document.querySelector('meta[name="viewport"]'),
      hasDesc: !!desc,
      ogImage: !!document.querySelector('meta[property="og:image"]'),
      h1: document.querySelectorAll("h1").length,
      lang: document.documentElement.lang || "",
      title: document.title || "",
      titleLen: (document.title || "").length,
      finalUrl: location.href,
      bodyText: (document.body ? document.body.innerText : "").trim().length,
      hasPassword: !!document.querySelector('input[type="password"]'),
    };
  });

  // chiudo i banner di consenso cookie più comuni prima di scattare
  try {
    // pass 1: click REALE via Playwright (gestisce bottoni React/pointer, es. Instagram)
    const labels = [/consenti tutti i cookie/i, /allow all cookies/i, /accetta tutti/i, /accetta tutto/i, /accetta e continua/i, /^accetta$/i, /^accetto$/i, /accept all/i, /allow all/i, /^ho capito/i];
    for (const re of labels) {
      const loc = page.getByRole("button", { name: re }).first();
      try { if (await loc.count()) { await loc.click({ timeout: 900 }); break; } } catch {}
    }
    await page.waitForTimeout(300);
    const sels = [
      "#onetrust-accept-btn-handler",
      ".iubenda-cs-accept-btn",
      "#CybotCookiebotDialogBodyButtonAccept",
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
      '[data-testid="uc-accept-all-button"]',
      ".fc-cta-consent",
    ];
    // i banner cookie vivono spesso dentro iframe → giro su tutti i frame
    for (const frame of page.frames()) {
      for (const s of sels) {
        const el = await frame.$(s).catch(() => null);
        if (el) await el.click({ timeout: 700 }).catch(() => {});
      }
      await frame
        .evaluate(() => {
          const rx = /^(accett|accetta tutt|accept all|accept|ho capito|consenti tutt|ok, ho capito|continua senza accettare)/i;
          for (const b of document.querySelectorAll('button,[role="button"],a')) {
            const t = (b.textContent || "").trim();
            if (t.length < 40 && rx.test(t)) { try { b.click(); } catch {} }
          }
        })
        .catch(() => {});
    }
    await page.waitForTimeout(600);
  } catch {}

  const shotBuf = await page.screenshot({ fullPage: false });
  const shotB64 = `data:image/png;base64,${shotBuf.toString("base64")}`;
  await ctx.close();

  // ---------- scoring + voce Pionio ----------
  const sec = (n) => (n / 1000).toFixed(1);
  const kb = (n) => Math.round(n / 1024);
  const findings = [];
  const add = (sev, titolo, dettaglio, meta = null) => findings.push({ sev, titolo, dettaglio, meta });

  if (metrics.lcp > 4000)
    add("critico", `Il contenuto principale compare dopo ${sec(metrics.lcp)} secondi`,
      `Google considera lento tutto sopra i 2,5s. A ${sec(metrics.lcp)}s una fetta grossa di chi arriva chiude prima ancora di vedere di cosa parli. È il problema che ti costa più clienti, in silenzio.`,
      `misurato ${sec(metrics.lcp)}s · soglia 2,5s · Google Core Web Vitals`);
  else if (metrics.lcp > 2500)
    add("attenzione", `Il contenuto principale compare in ${sec(metrics.lcp)} secondi`,
      `Sei oltre la soglia dei 2,5s che Google usa come riga di confine. Non è un disastro, ma su mobile e connessioni lente si sente: è la differenza tra "veloce" e "ci pensa".`,
      `misurato ${sec(metrics.lcp)}s · soglia 2,5s · Google Core Web Vitals`);
  else
    add("ok", `Il contenuto principale compare in ${sec(metrics.lcp)}s`, `Sotto la soglia. Qui sei a posto.`,
      `misurato ${sec(metrics.lcp)}s · soglia 2,5s · Google Core Web Vitals`);

  if (transferBytes > 3_000_000)
    add("critico", `La pagina pesa ${(transferBytes / 1e6).toFixed(1)} MB`,
      `Su uno smartphone in 4G questo si traduce in attesa e dati consumati. Le pagine che convertono stanno quasi sempre sotto 1,5 MB. Quasi sempre il colpevole sono le immagini non ottimizzate.`,
      `misurato ${(transferBytes / 1e6).toFixed(1)} MB · soglia consigliata 1,5 MB · byte reali scaricati`);
  else if (transferBytes > 1_500_000)
    add("attenzione", `La pagina pesa ${(transferBytes / 1e6).toFixed(1)} MB`,
      `Sopra la soglia comoda di 1,5 MB. Margine di alleggerimento c'è, soprattutto sulle immagini (${kb(imgBytes)} KB solo di immagini).`,
      `misurato ${(transferBytes / 1e6).toFixed(1)} MB · soglia consigliata 1,5 MB · byte reali scaricati`);

  if (imgBytes > 1_000_000)
    add("attenzione", `${kb(imgBytes)} KB di sole immagini`,
      `Convertendole in formato moderno (WebP/AVIF) e dimensionandole giuste qui si recupera quasi sempre più di metà del peso. È la leva con il miglior rapporto fatica/risultato.`,
      `misurato ${kb(imgBytes)} KB su ${metrics.imgCount} immagini`);

  if (metrics.cls > 0.1)
    add("attenzione", `Il layout si sposta mentre carica (CLS ${metrics.cls.toFixed(2)})`,
      `Gli elementi ballano durante il caricamento: chi sta per cliccare clicca la cosa sbagliata. Dà una sensazione di sito "non finito" anche quando il design è curato.`,
      `misurato ${metrics.cls.toFixed(2)} · soglia 0,1 · Google Core Web Vitals`);

  if (metrics.headScripts > 0)
    add("attenzione", `${metrics.headScripts} script bloccano il primo render`,
      `Sono nell'head senza async/defer: il browser si ferma ad aspettarli prima di disegnare la pagina. Spostarli o renderli differiti accorcia l'attesa percepita.`,
      `${metrics.headScripts} script render-blocking · senza async/defer`);

  if (!isHttps)
    add("critico", `Il sito non è su HTTPS`,
      `Il browser mostra "Non sicuro" nella barra. Nel 2026 è il primo motivo per cui un visitatore se ne va in due secondi. Va sistemato prima di tutto il resto.`);

  if (!metrics.title || metrics.titleLen < 10)
    add("critico", `Manca un titolo della pagina decente`, `Il titolo HTML è ciò che appare su Google e nei tab del browser. Vuoto o troppo corto = invisibile nella ricerca.`);
  if (!metrics.hasDesc)
    add("attenzione", `Manca la meta description`,
      `È il testo sotto al titolo nei risultati Google. Senza, Google se lo inventa — di solito male. Due righe scritte bene alzano i click a parità di posizione.`);
  if (!metrics.ogImage)
    add("attenzione", `Manca l'immagine di anteprima social (og:image)`,
      `Quando qualcuno condivide il link su WhatsApp/LinkedIn esce un riquadro vuoto e grigio. Un'anteprima curata fa la differenza tra un link cliccato e uno ignorato.`);
  if (metrics.h1 === 0)
    add("attenzione", `Nessun titolo H1 nella pagina`, `Google usa l'H1 per capire di cosa parli. Senza, deve indovinare.`);
  else if (metrics.h1 > 1)
    add("attenzione", `${metrics.h1} titoli H1 nella stessa pagina`, `Dovrebbe essercene uno solo: più H1 confondono i motori su qual è il messaggio principale.`,
      `trovati ${metrics.h1} H1 · consigliato 1`);
  if (!metrics.lang)
    add("attenzione", `Manca la lingua del sito (lang)`, `Senza l'attributo lang, screen reader e Google non sanno che il sito è in italiano.`);
  if (metrics.noAltImgs > 0)
    add("attenzione", `${metrics.noAltImgs} immagini senza testo alternativo`,
      `Sono invisibili a chi usa screen reader e a Google Immagini. Accessibilità e SEO nello stesso colpo.`,
      `${metrics.noAltImgs} su ${metrics.imgCount} immagini senza alt`);

  let score = 100;
  for (const f of findings) score -= f.sev === "critico" ? 18 : f.sev === "attenzione" ? 7 : 0;
  score = Math.max(5, Math.min(100, score));
  const grade = score >= 90 ? "Solido" : score >= 70 ? "Buono, con margini" : score >= 50 ? "Da sistemare" : "Critico";

  const critici = findings.filter((f) => f.sev === "critico").length;
  const verdetto =
    critici > 0
      ? `${critici === 1 ? "C'è 1 cosa che ti sta" : `Ci sono ${critici} cose che ti stanno`} costando visitatori adesso. Niente che richieda di rifare il sito: si sistemano una per una.`
      : score >= 90
      ? `Il sito è in salute. I dettagli sotto sono rifiniture, non emergenze.`
      : `Niente di rotto, ma diversi punti dove con poco lavoro guadagni velocità e fiducia.`;

  // app dietro login / guscio JS vuoto → i numeri non sono affidabili, lo dico
  let warning = null;
  let finalHost = host;
  let finalPath = "";
  try { const fu = new URL(metrics.finalUrl); finalHost = fu.host; finalPath = fu.pathname; } catch {}
  const authPath = /login|signin|sign-in|auth|account|i\/flow/i.test(finalPath);
  const platforms = {
    "instagram.com": "Instagram", "facebook.com": "Facebook", "fb.com": "Facebook",
    "x.com": "X", "twitter.com": "X (Twitter)", "tiktok.com": "TikTok",
    "linkedin.com": "LinkedIn", "youtube.com": "YouTube", "youtu.be": "YouTube",
    "pinterest.com": "Pinterest", "pinterest.it": "Pinterest", "threads.net": "Threads", "threads.com": "Threads",
  };
  const baseHost = host.replace(/^www\./, "");
  const platformName = platforms[baseHost];
  if (platformName)
    warning = `Questo è un profilo o una pagina su ${platformName}, non un tuo sito web. L'audit serve per il TUO sito: su social e piattaforme i numeri non significano niente, perché la pagina è costruita e gestita da loro, non da te.`;
  else if (finalHost && finalHost !== host)
    warning = `Sei stato reindirizzato a ${finalHost}: la pagina richiede quasi certamente un login. Questo audit è pensato per pagine pubbliche, quindi i numeri qui sotto vanno presi con le pinze.`;
  else if (authPath || (metrics.hasPassword && metrics.bodyText < 1500))
    warning = `Questa è una pagina di login o un'area riservata. L'audit è pensato per le pagine pubbliche che vedono i tuoi clienti, non per le schermate dietro autenticazione: qui il punteggio non significa molto.`;
  else if (metrics.domNodes < 400 || metrics.bodyText < 800)
    warning = `Questa pagina ha pochissimo contenuto misurabile: probabilmente è un'app, una schermata che si costruisce via JavaScript dopo il caricamento, o una pagina quasi vuota. Su pagine così l'audit non è affidabile.`;

  return { url, host, httpStatus, score, grade, verdetto, warning, metrics, transferBytes, requests, imgBytes, findings, shotB64, generatedAt: new Date().toISOString() };
}
