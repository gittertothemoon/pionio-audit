// Pionio Audit — card condivisibile
// Genera l'immagine social (IG 1080×1350 + X 1600×900) dal JSON di un audit.
//
// Uso:  node card.mjs <host>        (es. node card.mjs www.gazzetta.it)
// Prima devi aver lanciato:  node audit.mjs <url>

import { launchBrowser } from "./lib/launch.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL = "/Users/ivanpanto/.claude/skills/pionio-design";

const host = process.argv[2];
if (!host) {
  console.error("Uso: node card.mjs <host>   (prima: node audit.mjs <url>)");
  process.exit(1);
}
const dataPath = join(__dir, "report", `${host}.json`);
if (!existsSync(dataPath)) {
  console.error(`Nessun dato per ${host}. Lancia prima:  node audit.mjs https://${host}`);
  process.exit(1);
}
const d = JSON.parse(readFileSync(dataPath, "utf8"));

const css = readFileSync(join(SKILL, "colors_and_type.css"), "utf8").replaceAll(
  "url('fonts/",
  `url('file://${SKILL}/fonts/`
);
const pmarkB64 = `data:image/png;base64,${readFileSync(join(SKILL, "assets", "pionio-p-mark.png")).toString("base64")}`;

const sevDot = { critico: "#f43f5e", attenzione: "#e0b341", ok: "#62a481" };
const gradeColor = d.score >= 70 ? "var(--accent-400)" : d.score >= 50 ? "#e0b341" : "#f43f5e";

// ordino: critici, poi attenzioni, poi ok — e tengo i più importanti
const sevRank = { critico: 0, attenzione: 1, ok: 2 };
const top = [...d.findings].sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);

const shot = d.shotB64 || "";

// versione breve del verdetto per la card (prima frase)
const verdettoBreve = d.verdetto.split(/(?<=[.!?])\s/)[0];

function findingsRows(n) {
  return top
    .slice(0, n)
    .map(
      (f) => `
      <div class="row">
        <span class="dot" style="background:${sevDot[f.sev]}"></span>
        <span class="rtitle">${f.titolo}</span>
      </div>`
    )
    .join("");
}

const sharedHead = `<meta charset="utf-8"><style>${css}
  * { margin:0; box-sizing:border-box; }
  html,body { width:100%; height:100%; }
  .card { position:relative; overflow:hidden; background:var(--bg);
          background-image:
            radial-gradient(80% 60% at 80% -10%, rgba(48,107,77,0.18), transparent 60%),
            radial-gradient(60% 40% at -10% 110%, rgba(48,107,77,0.10), transparent 60%); }
  .pmark { object-fit:contain; flex:none; filter:drop-shadow(0 2px 8px rgba(0,0,0,.5)); }
  .head { display:flex; align-items:center; gap:16px; }
  .eyebrow { font-family:var(--font-mono); letter-spacing:var(--tr-widest); text-transform:uppercase; color:var(--fg-3); }
  .url { font-family:var(--font-mono); color:var(--fg-3); }
  .score { font-family:var(--font-sans); font-weight:500; line-height:0.9; letter-spacing:-0.03em; color:var(--fg-1); }
  .score sup { font-weight:400; color:var(--fg-3); }
  .grade { font-family:var(--font-sans); font-weight:500; letter-spacing:-0.02em; color:${gradeColor}; }
  .verdetto { color:var(--fg-1); font-family:var(--font-sans); line-height:1.35; }
  .shot { object-fit:cover; object-position:top; border:1px solid var(--border-2);
          box-shadow:var(--shadow-2); display:block; background:var(--surface-2); }
  .row { display:flex; align-items:center; gap:16px; }
  .dot { border-radius:50%; flex:none; }
  .rtitle { font-family:var(--font-sans); color:var(--fg-2); }
  .cta { display:flex; align-items:baseline; gap:14px; }
  .cta-main { font-family:var(--font-sans); font-weight:500; color:var(--fg-1); }
  .cta-url { font-family:var(--font-sans); font-weight:500; color:var(--accent-400); }
</style>`;

// ---------- IG verticale 1080×1350 ----------
const ig = `<!doctype html><html lang="it"><head>${sharedHead}<style>
  .card { width:1080px; height:1350px; padding:84px 80px;
          display:flex; flex-direction:column; }
  .pmark { width:52px; height:52px; font-size:30px; }
  .eyebrow { font-size:17px; }
  .shot { width:100%; height:392px; border-radius:24px; margin-top:48px; }
  .scoreblock { display:flex; align-items:flex-end; gap:28px; margin-top:52px; }
  .score { font-size:200px; }
  .score sup { font-size:48px; }
  .grade { font-size:40px; padding-bottom:30px; }
  .url { font-size:22px; padding-bottom:38px; }
  .verdetto { font-size:34px; margin-top:40px; max-width:880px; }
  .rows { margin-top:44px; display:flex; flex-direction:column; gap:26px; }
  .dot { width:14px; height:14px; }
  .rtitle { font-size:30px; }
  .spacer { flex:1; }
  .cta { padding-top:40px; border-top:1px solid var(--border-1); }
  .cta-main { font-size:30px; }
  .cta-url { font-size:30px; }
</style></head><body>
  <div class="card">
    <div class="head">
      <img class="pmark" src="${pmarkB64}">
      <span class="eyebrow">Audit istantaneo</span>
    </div>
    ${shot ? `<img class="shot" src="${shot}">` : ""}
    <div class="scoreblock">
      <div class="score">${d.score}<sup>/100</sup></div>
      <div>
        <div class="grade">${d.grade}</div>
        <div class="url">${d.host}</div>
      </div>
    </div>
    <div class="verdetto">${verdettoBreve}</div>
    <div class="rows">${findingsRows(3)}</div>
    <div class="spacer"></div>
    <div class="cta">
      <span class="cta-main">Si sistemano.</span>
      <span class="cta-url">pionio.it</span>
    </div>
  </div>
</body></html>`;

// ---------- X orizzontale 1600×900 ----------
const x = `<!doctype html><html lang="it"><head>${sharedHead}<style>
  .card { width:1600px; height:900px; padding:72px 80px; display:flex; gap:64px; }
  .left { width:760px; display:flex; flex-direction:column; }
  .right { flex:1; display:flex; align-items:center; }
  .pmark { width:46px; height:46px; font-size:26px; }
  .eyebrow { font-size:16px; }
  .scoreblock { display:flex; align-items:flex-end; gap:24px; margin-top:40px; }
  .score { font-size:170px; }
  .score sup { font-size:42px; }
  .grade { font-size:36px; padding-bottom:24px; }
  .url { font-size:20px; padding-bottom:30px; }
  .verdetto { font-size:30px; margin-top:32px; }
  .rows { margin-top:36px; display:flex; flex-direction:column; gap:22px; }
  .dot { width:13px; height:13px; }
  .rtitle { font-size:27px; }
  .spacer { flex:1; }
  .cta { padding-top:32px; border-top:1px solid var(--border-1); }
  .cta-main { font-size:27px; }
  .cta-url { font-size:27px; }
  .shot { width:100%; height:580px; border-radius:24px; }
</style></head><body>
  <div class="card">
    <div class="left">
      <div class="head">
        <div class="pmark">P</div>
        <span class="eyebrow">Pionio · Audit istantaneo</span>
      </div>
      <div class="scoreblock">
        <div class="score">${d.score}<sup>/100</sup></div>
        <div>
          <div class="grade">${d.grade}</div>
          <div class="url">${d.host}</div>
        </div>
      </div>
      <div class="verdetto">${verdettoBreve}</div>
      <div class="rows">${findingsRows(3)}</div>
      <div class="spacer"></div>
      <div class="cta">
        <span class="cta-main">Si sistemano.</span>
        <span class="cta-url">pionio.it</span>
      </div>
    </div>
    <div class="right">
      ${shot ? `<img class="shot" src="${shot}">` : ""}
    </div>
  </div>
</body></html>`;

const formats = [
  { name: "ig", html: ig, w: 1080, h: 1350 },
  { name: "x", html: x, w: 1600, h: 900 },
];

const browser = await launchBrowser();
for (const f of formats) {
  const page = await browser.newPage({
    viewport: { width: f.w, height: f.h },
    deviceScaleFactor: 2,
  });
  await page.setContent(f.html, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const out = join(__dir, "report", `${host}.card-${f.name}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: f.w, height: f.h } });
  await page.close();
  console.log(`  ${f.name.toUpperCase()} ${f.w}×${f.h}  →  ${out}`);
}
await browser.close();
