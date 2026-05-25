// Render server-side di una card PNG brandizzata da scaricare/condividere.
// Font e P-mark incorporati in base64 (zero dipendenze esterne → funziona anche in Docker).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dir, "..", "public");
const b64 = (p, mime) => `data:${mime};base64,${readFileSync(p).toString("base64")}`;

// letti una sola volta all'avvio
const F = {
  r: b64(join(PUB, "fonts", "Geist-Regular.ttf"), "font/ttf"),
  m: b64(join(PUB, "fonts", "Geist-Medium.ttf"), "font/ttf"),
  b: b64(join(PUB, "fonts", "Geist-Bold.ttf"), "font/ttf"),
  mono: b64(join(PUB, "fonts", "GeistMono-Regular.ttf"), "font/ttf"),
};
const PMARK = b64(join(PUB, "brand", "pmark.png"), "image/png");
const FONT_CSS = `
@font-face{font-family:'Geist';src:url(${F.r}) format('truetype');font-weight:400}
@font-face{font-family:'Geist';src:url(${F.m}) format('truetype');font-weight:500}
@font-face{font-family:'Geist';src:url(${F.b}) format('truetype');font-weight:700}
@font-face{font-family:'Geist Mono';src:url(${F.mono}) format('truetype');font-weight:400}`;

const sevDot = { critico: "#f43f5e", attenzione: "#e0b341", ok: "#62a481" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function cardHtml(d) {
  const r = d.desktop;
  const gradeColor = r.score >= 70 ? "#62a481" : r.score >= 50 ? "#e0b341" : "#f43f5e";
  const order = { critico: 0, attenzione: 1, ok: 2 };
  const top = [...r.findings].sort((a, b) => order[a.sev] - order[b.sev]).slice(0, 3);
  const verdettoBreve = esc(r.verdetto.split(/(?<=[.!?])\s/)[0]);
  const positive = r.score >= 90; // su un punteggio alto il taglio resta positivo
  const rows = top
    .map((f) => `<div class="row"><span class="dot" style="background:${sevDot[f.sev]}"></span><span class="rt">${esc(f.titolo)}</span></div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}
  *{margin:0;box-sizing:border-box}
  .card{width:1080px;min-height:1350px;padding:80px;background:#09090b;
    background-image:radial-gradient(80% 60% at 85% -8%,rgba(48,107,77,.20),transparent 58%),radial-gradient(55% 38% at -12% 112%,rgba(48,107,77,.12),transparent 60%);
    display:flex;flex-direction:column;font-family:'Geist',system-ui,sans-serif;color:#fafafa}
  .head{display:flex;align-items:center;gap:16px}
  .pmark{width:50px;height:50px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.5))}
  .eyebrow{font-family:'Geist Mono',monospace;font-size:17px;letter-spacing:.18em;text-transform:uppercase;color:#71717a}
  /* finestra browser attorno allo screenshot */
  .browser{margin-top:46px;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.10);box-shadow:0 30px 60px -20px rgba(0,0,0,.6);background:#18181b}
  .bar{height:60px;display:flex;align-items:center;gap:11px;padding:0 26px;background:#0f0f12;border-bottom:1px solid rgba(255,255,255,.06)}
  .tl{width:13px;height:13px;border-radius:50%;background:#3f3f46;flex:none}
  .addr{margin-left:18px;font-family:'Geist Mono',monospace;font-size:20px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .shot{width:100%;height:auto;display:block;background:#18181b}
  .sb{margin-top:56px}
  .score{font-size:172px;font-weight:500;line-height:.82;letter-spacing:-.04em}
  .score sup{font-size:44px;color:#71717a;font-weight:400}
  .meta{display:flex;align-items:center;gap:24px;margin-top:26px;flex-wrap:wrap}
  .badge{display:inline-flex;padding:11px 26px;border-radius:999px;border:1px solid;font-size:30px;font-weight:500;line-height:1;color:${gradeColor};border-color:${gradeColor}66}
  .url{font-family:'Geist Mono',monospace;font-size:22px;color:#71717a}
  .verdetto{font-size:35px;margin-top:46px;max-width:900px;line-height:1.32;color:#fafafa}
  .rows{margin-top:42px;display:flex;flex-direction:column;gap:26px}
  .dot{width:14px;height:14px;border-radius:50%;flex:none}
  .row{display:flex;align-items:center;gap:18px}
  .rt{font-size:31px;color:#d4d4d8}
  .spacer{flex:1;min-height:30px}
  .cta{padding-top:38px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:14px;align-items:baseline}
  .cta b{font-weight:500;font-size:31px}
  .cta span{color:#62a481;font-weight:500;font-size:31px}
  </style></head><body>
  <div class="card">
    <div class="head"><img class="pmark" src="${PMARK}"><span class="eyebrow">Audit istantaneo</span></div>
    <div class="browser">
      <div class="bar"><span class="tl"></span><span class="tl"></span><span class="tl"></span><span class="addr">${esc(d.host)}</span></div>
      <img class="shot" src="${r.shotB64}">
    </div>
    <div class="sb"><div class="score">${Number(r.score)}<sup>/100</sup></div></div>
    <div class="meta"><span class="badge">${esc(r.grade)}</span><span class="url">${esc(d.url || d.host)}</span></div>
    <div class="verdetto">${verdettoBreve}</div>
    <div class="rows">${rows}</div>
    <div class="spacer"></div>
    <div class="cta"><b>${positive ? "Fatto bene." : "Si sistemano."}</b><span>pionio.it</span></div>
  </div></body></html>`;
}

export async function renderExportCard(browser, d) {
  if (!d || !d.desktop || !d.desktop.shotB64) throw new Error("Dati del report mancanti.");
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
  try {
    await page.setContent(cardHtml(d), { waitUntil: "networkidle" });
    await page.waitForTimeout(150);
    const card = await page.$(".card");           // screenshot dell'elemento → altezza dinamica, niente taglio
    return await card.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}
