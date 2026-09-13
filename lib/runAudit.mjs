// Motore dell'audit — misura mobile + desktop, scoring graduato, voce Pionio.
// Riusato da CLI (audit.mjs) e server (server.mjs). Non scrive file.

import { attachRequestGuard } from "./guard.mjs";

const PLATFORMS = {
  "instagram.com": "Instagram", "facebook.com": "Facebook", "fb.com": "Facebook",
  "x.com": "X", "twitter.com": "X (Twitter)", "tiktok.com": "TikTok",
  "linkedin.com": "LinkedIn", "youtube.com": "YouTube", "youtu.be": "YouTube",
  "pinterest.com": "Pinterest", "pinterest.it": "Pinterest", "threads.net": "Threads", "threads.com": "Threads",
};

const VIEWPORTS = {
  desktop: {
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    // UA di Chrome reale, senza suffisso identificativo: i muri anti-bot (Akamai &
    // simili, es. yoox) bloccano gli UA marcati come tool. Misuriamo davvero con Chrome.
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  },
  mobile: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

// errore di caricamento tecnico (Playwright/Chrome) → messaggio umano in voce Pionio
function loadErrorMessage(rawMsg) {
  const m = rawMsg || "";
  if (/ERR_NAME_NOT_RESOLVED|getaddrinfo|ENOTFOUND|ERR_ADDRESS_UNREACHABLE/i.test(m))
    return "Non trovo questo indirizzo. Controlla che sia scritto giusto — senza spazi o errori di battitura.";
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(m))
    return "Il sito ha rifiutato la connessione. Può essere temporaneamente offline: riprova tra poco.";
  if (/ERR_CERT|ERR_SSL|SSL_|certificate/i.test(m))
    return "Il certificato di sicurezza del sito dà problemi e il browser blocca il caricamento — di solito è scaduto o mal configurato.";
  if (/Timeout|timed out|exceeded|Navigation timeout/i.test(m))
    return "Il sito ci ha messo troppo a rispondere e non sono riuscito a misurarlo. Spesso vuol dire che è davvero lento o momentaneamente sovraccarico: riprova tra poco.";
  if (/Target crashed|Page crashed|browser has (?:disconnected|been closed)|Target (?:closed|page).*crashed/i.test(m))
    return "Questo sito carica così tante cose che non riesco a misurarlo in un colpo solo. Lo strumento è gratis e gira leggero: qui il limite è mio, non del tuo sito. Riprova tra poco — o, se è un sito a cui tieni, scrivimi e lo guardo a mano.";
  // ERR_HTTP2_PROTOCOL_ERROR, ed errori generici
  return "Non riesco a caricare questo sito: respinge gli strumenti automatici come questo, o è momentaneamente irraggiungibile. Riprova tra poco, o controlla che l'indirizzo sia giusto.";
}

// ---------- misura un singolo viewport ----------
async function measure(browser, url, vpConf, opts) {
  const ctx = await browser.newContext(vpConf);
  try {
    const page = await ctx.newPage();
    if (opts.guardRequests) await attachRequestGuard(page);

    let transferBytes = 0, imgBytes = 0, requests = 0;
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
      window.__lcp = 0; window.__cls = 0;
      try {
        new PerformanceObserver((l) => { const es = l.getEntries(); window.__lcp = es[es.length - 1].startTime; })
          .observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
          .observe({ type: "layout-shift", buffered: true });
      } catch {}
    });

    // "domcontentloaded" è molto più affidabile di "load" sui siti pesanti:
    // su e-commerce grossi il "load" completo (tutte immagini/iframe) spesso non
    // scatta mai entro il timeout, oppure va in HTTP2_PROTOCOL_ERROR / crash tab.
    // Un retry assorbe gli errori transitori (es. ERR_HTTP2_PROTOCOL_ERROR di yoox).
    let httpStatus = 0, nav = null, lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await page.waitForTimeout(800).catch(() => {}); // respiro prima del retry
      }
    }
    if (lastErr) throw lastErr; // tradotto in voce Pionio una volta sola in runAudit()
    httpStatus = nav ? nav.status() : 0;
    // diamo tempo al resto di assestarsi, ma senza bloccarci se "load" non scatta mai
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const paint = performance.getEntriesByType("paint");
      const fcp = paint.find((p) => p.name === "first-contentful-paint");
      const imgs = [...document.images];
      const desc = document.querySelector('meta[name="description"]');
      return {
        ttfb: nav.responseStart || 0,
        fcp: fcp ? fcp.startTime : 0,
        lcp: window.__lcp || 0,
        cls: window.__cls || 0,
        domNodes: document.querySelectorAll("*").length,
        imgCount: imgs.length,
        // alt="" is the correct marker for a decorative image (WCAG H67): only a missing attribute is a fault.
        noAltImgs: imgs.filter((i) => !i.hasAttribute("alt")).length,
        // Module scripts are deferred by the browser even without the attribute, so they never block render.
        headScripts: [...document.head.querySelectorAll("script[src]")].filter((s) => !s.async && !s.defer && s.type !== "module").length,
        viewport: !!document.querySelector('meta[name="viewport"]'),
        hasDesc: !!desc,
        ogImage: !!document.querySelector('meta[property="og:image"]'),
        h1: document.querySelectorAll("h1").length,
        lang: document.documentElement.lang || "",
        title: document.title || "",
        titleLen: (document.title || "").length,
        finalUrl: location.href,
        bodyText: (document.body ? document.body.innerText : "").trim().length,
        bodyTextSnippet: (document.body ? document.body.innerText : "").trim().slice(0, 500),
        hasPassword: !!document.querySelector('input[type="password"]'),
      };
    });

    // chiudo i banner cookie prima dello scatto (leggero: i social sono già esclusi prima)
    try {
      const sels = ["#onetrust-accept-btn-handler", ".iubenda-cs-accept-btn", "#CybotCookiebotDialogBodyButtonAccept", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", '[data-testid="uc-accept-all-button"]', ".fc-cta-consent"];
      for (const frame of page.frames()) {
        for (const s of sels) { const el = await frame.$(s).catch(() => null); if (el) await el.click({ timeout: 500 }).catch(() => {}); }
        await frame.evaluate(() => {
          const rx = /^(accett|accetta tutt|accept all|accept|ho capito|consenti tutt|ok, ho capito|continua senza accettare)/i;
          for (const b of document.querySelectorAll('button,[role="button"],a')) {
            const t = (b.textContent || "").trim();
            if (t.length < 40 && rx.test(t)) { try { b.click(); } catch {} }
          }
        }).catch(() => {});
      }
      await page.waitForTimeout(300);
    } catch {}

    const shotBuf = await page.screenshot({ type: "jpeg", quality: 72, fullPage: false, timeout: 15000 });
    const shotB64 = `data:image/jpeg;base64,${shotBuf.toString("base64")}`;
    return { httpStatus, metrics, transferBytes, imgBytes, requests, shotB64 };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ---------- scoring + findings da un set di metriche ----------
function analyze({ metrics, transferBytes, imgBytes, isHttps }) {
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
      `Su uno smartphone in 4G significa attesa e dati bruciati. Le pagine che convertono stanno quasi sempre sotto 1,5 MB. Il colpevole, di solito, sono le immagini non ottimizzate.`,
      `misurato ${(transferBytes / 1e6).toFixed(1)} MB · soglia consigliata 1,5 MB · byte reali scaricati`);
  else if (transferBytes > 1_500_000)
    add("attenzione", `La pagina pesa ${(transferBytes / 1e6).toFixed(1)} MB`,
      `Sopra la soglia comoda di 1,5 MB. Margine di alleggerimento c'è, soprattutto sulle immagini (${kb(imgBytes)} KB solo di immagini).`,
      `misurato ${(transferBytes / 1e6).toFixed(1)} MB · soglia consigliata 1,5 MB · byte reali scaricati`);

  if (imgBytes > 1_000_000)
    add("attenzione", `${kb(imgBytes)} KB di sole immagini`,
      `Convertendole in formato moderno (WebP/AVIF) e dimensionandole come si deve, qui recuperi spesso più di metà del peso. È la mossa che rende di più con meno fatica.`,
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
      `Quando qualcuno condivide il link su WhatsApp o LinkedIn esce un riquadro vuoto e grigio. Con un'anteprima curata il link si fa notare; senza, scorre via.`);
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

  // penalità graduate (curve, non scalini) ancorate alle bande Google Core Web Vitals
  const ramp = (val, good, poor, maxPen) =>
    val <= good ? 0 : val >= poor ? maxPen : (maxPen * (val - good)) / (poor - good);
  let penalty = 0;
  penalty += ramp(metrics.lcp, 2500, 6000, 22);
  penalty += ramp(transferBytes, 1_500_000, 5_000_000, 20);
  penalty += ramp(metrics.cls, 0.1, 0.5, 12);
  penalty += ramp(imgBytes, 1_200_000, 4_000_000, 8);
  penalty += Math.min(metrics.headScripts * 2, 8);
  if (!isHttps) penalty += 25;
  if (!metrics.title || metrics.titleLen < 10) penalty += 12;
  if (!metrics.hasDesc) penalty += 3;
  if (!metrics.ogImage) penalty += 3;
  if (metrics.h1 === 0) penalty += 4; else if (metrics.h1 > 1) penalty += 3;
  if (!metrics.lang) penalty += 2;
  if (metrics.noAltImgs > 0) penalty += Math.min(2 + Math.round((4 * metrics.noAltImgs) / Math.max(1, metrics.imgCount)), 6);

  const score = Math.max(5, Math.min(100, Math.round(100 - penalty)));
  const grade = score >= 90 ? "Solido" : score >= 70 ? "Buono, con margini" : score >= 50 ? "Da sistemare" : "Critico";
  // conteggio unico = tutti i problemi (critico + attenzione), usato sia qui sia nella CTA
  const nProblems = findings.filter((f) => f.sev !== "ok").length;
  const verdetto =
    score >= 90
      ? `Il sito è in salute. I dettagli sotto sono rifiniture, non emergenze.`
      : nProblems > 0
      ? `${nProblems === 1 ? "C'è 1 cosa che ti sta" : `Ci sono ${nProblems} cose che ti stanno`} costando visitatori. Niente che richieda di rifare il sito: si sistemano una per una.`
      : `Niente di rotto, ma qualche punto dove guadagni velocità e fiducia.`;

  return { findings, score, grade, verdetto };
}

// ---------- audit completo ----------
export async function runAudit(rawUrl, browser, opts = {}) {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const host = new URL(url).host;
  const isHttps = url.startsWith("https://");
  const baseHost = host.replace(/^www\./, "");
  const generatedAt = new Date().toISOString();

  // i social non si "auditano": rilevo dall'host PRIMA di misurare e mi fermo
  const platformName = PLATFORMS[baseHost];
  if (platformName) {
    return {
      url, host, generatedAt, warningType: "platform", platformName,
      warning: `Questo è un profilo ${platformName} 👋 Il nostro audit serve per il tuo sito web — quello che possiedi e gestisci tu. Incolla l'indirizzo del tuo sito e ci pensiamo noi.`,
    };
  }

  // due passate in PARALLELO (viste indipendenti → si sovrappongono, ~metà tempo)
  // qualunque errore Playwright (goto, evaluate, screenshot, crash della tab) viene
  // tradotto qui in un unico punto → all'utente non arriva mai un log tecnico grezzo
  let mobileRaw, desktopRaw;
  try {
    [mobileRaw, desktopRaw] = await Promise.all([
      measure(browser, url, VIEWPORTS.mobile, opts),
      measure(browser, url, VIEWPORTS.desktop, opts),
    ]);
  } catch (e) {
    throw new Error(loadErrorMessage(e.message));
  }

  // warning login/app/pagina povera (da una passata, il DOM è lo stesso)
  const m = desktopRaw.metrics;

  // Muro anti-bot (Cloudflare / DDoS-Guard / Incapsula…): lo strumento viene visto come bot
  // e riceve una pagina di verifica al posto del sito vero. Niente punteggio: sarebbe falso.
  // Gate su pagina "thin" per non beccare siti veri che citano queste frasi nei contenuti.
  // include sia le pagine di "verifica" (Cloudflare/Incapsula) sia le pagine di
  // BLOCCO/errore servite dai bot-manager (es. mytheresa/Akamai: "Reference BOT:").
  const CHALLENGE_RE = /performing security verification|checking your browser|checking if the site connection is secure|verify(?:ing)? you are human|attention required|enable javascript and cookies to continue|ddos protection by|ddos-guard|incapsula incident|request unsuccessful|cf-browser-verification|please (?:wait|stand by) while|reference\s*bot|access denied|you (?:have been|are) blocked|you don'?t have permission to access|request blocked|akamai/i;
  const challengeBlob = `${m.title || ""} ${m.bodyTextSnippet || ""}`;
  if (m.bodyText < 1500 && CHALLENGE_RE.test(challengeBlob)) {
    return {
      url, host, generatedAt, warningType: "challenge",
      warning: `Questo sito è protetto da un sistema anti-bot (tipo Cloudflare) che blocca gli strumenti automatici come questo. Non riesco a vedere il sito vero, quindi non ti do un punteggio: sarebbe falso.`,
    };
  }

  // NB: il redirect www/non-www (es. pinalli.it → www.pinalli.it) è normalissimo e NON
  // significa login. I login veri li riconosciamo da path/campo password/pagina vuota.
  let warning = null, warningType = null;
  let finalPath = "";
  try { finalPath = new URL(m.finalUrl).pathname; } catch {}
  if (/\/(login|signin|sign-in|auth|account)(\/|$)|i\/flow/i.test(finalPath) || (m.hasPassword && m.bodyText < 1500)) {
    warningType = "auth";
    warning = `Questa è una pagina di login o un'area riservata. L'audit è pensato per le pagine pubbliche che vedono i tuoi clienti, non per le schermate dietro autenticazione: qui il punteggio non significa molto.`;
  } else if (m.domNodes < 400 || m.bodyText < 800) {
    warningType = "thin";
    warning = `Questa pagina ha pochissimo contenuto misurabile: probabilmente è un'app, una schermata che si costruisce via JavaScript dopo il caricamento, o una pagina quasi vuota. Su pagine così l'audit non è affidabile.`;
  }

  // easter egg: casa nostra
  const easterEgg = /^(www\.)?pionio\.it$/i.test(host)
    ? "Ehi, ma questo è il nostro sito. Tranquillo: il punteggio l'ha calcolato la macchina con lo stesso identico metro di tutti gli altri — non abbiamo toccato niente. (Promesso.)"
    : null;

  const mk = (raw) => ({
    ...analyze({ metrics: raw.metrics, transferBytes: raw.transferBytes, imgBytes: raw.imgBytes, isHttps }),
    metrics: raw.metrics, transferBytes: raw.transferBytes, imgBytes: raw.imgBytes,
    requests: raw.requests, httpStatus: raw.httpStatus, shotB64: raw.shotB64,
  });

  return {
    url, host, generatedAt, warning, warningType, easterEgg,
    mobile: mk(mobileRaw),
    desktop: mk(desktopRaw),
  };
}
