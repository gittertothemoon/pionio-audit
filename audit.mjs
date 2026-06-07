// Pionio Audit — CLI. Usa lo stesso motore del server (lib/runAudit) così
// punteggi e voce sono identici. Scrive report HTML + JSON in report/.
//
// Uso:  node audit.mjs https://esempio.it

import { launchBrowser } from "./lib/launch.mjs";
import { runAudit } from "./lib/runAudit.mjs";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
// Asset di brand (CSS + font + p-mark) per la card esportabile. Esterni al repo:
// imposta PIONIO_SKILL_DIR per puntarci, altrimenti ./brand in locale.
const SKILL = process.env.PIONIO_SKILL_DIR || join(__dir, "brand");

const rawUrl = process.argv[2];
if (!rawUrl) { console.error("Uso: node audit.mjs <url>"); process.exit(1); }

const browser = await launchBrowser();
const d = await runAudit(rawUrl, browser);
await browser.close();

mkdirSync(join(__dir, "report"), { recursive: true });
writeFileSync(join(__dir, "report", `${d.host}.json`), JSON.stringify(d, null, 2));

if (d.warningType === "platform") {
  console.log(`\n  ${d.host} → è un profilo ${d.platformName}, non un sito da auditare.\n`);
  process.exit(0);
}

// ---------- report HTML (passata desktop) ----------
const r = d.desktop;
const css = readFileSync(join(SKILL, "colors_and_type.css"), "utf8").replaceAll("url('fonts/", `url('file://${SKILL}/fonts/`);
const pmarkB64 = `data:image/png;base64,${readFileSync(join(SKILL, "assets", "pionio-p-mark.png")).toString("base64")}`;
const sevDot = { critico: "var(--danger)", attenzione: "#e0b341", ok: "var(--accent-400)" };
const sevLabel = { critico: "CRITICO", attenzione: "DA GUARDARE", ok: "✓ A POSTO" };

const findingsHtml = r.findings
  .map((f) => `
    <div class="finding">
      <div class="dot" style="background:${sevDot[f.sev]}"></div>
      <div class="fbody">
        <span class="ftag" style="color:${sevDot[f.sev]}">${sevLabel[f.sev]}</span>
        <h3 class="t-h3 ftitle">${f.titolo}</h3>
        <p class="t-body fdetail">${f.dettaglio}</p>
        ${f.meta ? `<div class="fmeta">${f.meta}</div>` : ""}
      </div>
    </div>`)
  .join("");

const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Audit Pionio — ${d.host}</title>
<style>${css}
  * { margin:0; box-sizing:border-box; }
  body { padding: var(--s-9) var(--s-6); max-width: 920px; margin: 0 auto; }
  .eyebrow-row { display:flex; align-items:center; gap: var(--s-3); margin-bottom: var(--s-5); }
  .pmark { width:34px; height:34px; object-fit:contain; filter:drop-shadow(0 2px 8px rgba(0,0,0,.5)); }
  .hero { display:grid; grid-template-columns: 0.8fr 1.2fr; gap: var(--s-7); align-items:center;
          padding: var(--s-7); background: var(--surface-2); border:1px solid var(--border-2);
          border-radius: var(--r-xl); margin-bottom: var(--s-7); }
  .score { font-family:var(--font-sans); font-weight:500; font-size: 5rem; line-height:.85; letter-spacing:-.03em; color: var(--fg-1); }
  .score small { font-size: 2rem; color: var(--fg-3); }
  .scores2 { font-family:var(--font-mono); font-size: var(--t-caption); color: var(--fg-3); margin-top: var(--s-4); }
  .grade { margin-top: var(--s-3); }
  .shot { width:100%; border-radius: var(--r-md); border:1px solid var(--border-2); box-shadow: var(--shadow-2); display:block; }
  .verdetto { padding: var(--s-5) var(--s-6); border-left: 2px solid var(--accent-600); background: var(--accent-950);
              border-radius: 0 var(--r-md) var(--r-md) 0; margin-bottom: var(--s-8); }
  .findings { display:flex; flex-direction:column; gap: var(--s-2); }
  .finding { display:flex; gap: var(--s-4); padding: var(--s-5); border:1px solid var(--border-1); border-radius: var(--r-md); background: var(--surface-1); }
  .dot { width:10px; height:10px; border-radius:50%; margin-top: 7px; flex:none; }
  .ftag { font-family:var(--font-mono); font-size: var(--t-micro); letter-spacing: var(--tr-widest); }
  .ftitle { margin: 4px 0 6px; }
  .fmeta { display:inline-block; margin-top:10px; padding:4px 10px; border:1px solid var(--border-1); border-radius:999px;
           font-family:var(--font-mono); font-size:11px; color:var(--fg-3); }
  .cta { margin-top: var(--s-9); padding: var(--s-8); text-align:center; background: var(--surface-2); border:1px solid var(--border-2); border-radius: var(--r-xl); }
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
      <div class="score">${r.score}<small>/100</small></div>
      <div class="grade t-h3" style="color:${r.score >= 70 ? "var(--accent-400)" : "#e0b341"}">${r.grade}</div>
      <div class="scores2">desktop ${r.score} · mobile ${d.mobile.score}</div>
      <p class="t-url" style="margin-top:var(--s-3)">${d.url}</p>
    </div>
    <img class="shot" src="${r.shotB64}" alt="${d.host}">
  </div>
  <div class="verdetto">
    <span class="t-eyebrow t-eyebrow--accent">IL VERDETTO</span>
    <p class="t-body-lg" style="margin-top:var(--s-2); color:var(--fg-1)">${r.verdetto}</p>
  </div>
  <div class="findings">${findingsHtml}</div>
  <div class="cta">
    <span class="t-eyebrow">E ADESSO?</span>
    <h2 class="t-h2" style="margin:var(--s-3) 0">Questi problemi si sistemano.<br>Vuoi che lo facciamo noi?</h2>
    <a class="t-body-lg" href="https://pionio.it">→ pionio.it</a>
  </div>
  <div class="footer"><span class="t-caption">Generato da Pionio Audit · ${new Date().toLocaleDateString("it-IT")}</span></div>
</body></html>`;

writeFileSync(join(__dir, "report", `${d.host}.html`), html);

console.log(`\n  PIONIO AUDIT — ${d.host}`);
console.log(`  ${"─".repeat(46)}`);
console.log(`  Desktop ${r.score}/100 (${r.grade}) · Mobile ${d.mobile.score}/100 (${d.mobile.grade})`);
console.log(`  LCP ${(r.metrics.lcp / 1000).toFixed(1)}s · peso ${(r.transferBytes / 1e6).toFixed(1)} MB · ${r.requests} richieste`);
if (d.warning) console.log(`  ⚠ ${d.warning}`);
console.log(`  ${"─".repeat(46)}`);
console.log(`  Report → report/${d.host}.html\n`);
