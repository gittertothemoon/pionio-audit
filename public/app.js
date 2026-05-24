// Pionio Audit — front-end. Esterno (non inline) per poter applicare una CSP severa.
const $ = (s) => document.querySelector(s);
const sections = { landing: $("#landing"), loading: $("#loading"), result: $("#result") };
function show(name) { for (const k in sections) sections[k].classList.toggle("active", k === name); }

// escape di tutto ciò che deriva dall'input utente prima di metterlo in innerHTML
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sevDot = { critico: "var(--danger)", attenzione: "var(--warn)", ok: "var(--accent-300)" };
const sevLabel = { critico: "CRITICO", attenzione: "DA GUARDARE", ok: "✓ A POSTO" };

let stepTimer;
function runLoadingAnim() {
  const steps = [...document.querySelectorAll("#lsteps .step")];
  const bar = $("#lbar"); let i = 0;
  steps.forEach((s) => (s.className = "step"));
  bar.style.width = "8%";
  const tick = () => {
    if (i > 0) steps[i - 1].className = "step done";
    if (i < steps.length) { steps[i].className = "step now"; bar.style.width = 12 + i * 26 + "%"; i++; }
  };
  tick(); stepTimer = setInterval(tick, 1600);
}
function stopLoadingAnim() {
  clearInterval(stepTimer);
  document.querySelectorAll("#lsteps .step").forEach((s) => (s.className = "step done"));
  $("#lbar").style.width = "100%";
}

function gradeColor(score) { return score >= 70 ? "var(--accent-400)" : score >= 50 ? "var(--warn)" : "var(--danger)"; }

function renderResult(d) {
  const order = { critico: 0, attenzione: 1, ok: 2 };
  const findings = [...d.findings].sort((a, b) => order[a.sev] - order[b.sev]);
  // titolo/dettaglio/meta sono generati dal server da stringhe fisse + numeri (non input utente)
  const fhtml = findings
    .map(
      (f) => `
    <div class="finding">
      <div class="fdot" style="background:${sevDot[f.sev]}"></div>
      <div>
        <div class="ftag" style="color:${sevDot[f.sev]}">${sevLabel[f.sev]}</div>
        <h3>${f.titolo}</h3>
        <p>${f.dettaglio}</p>
        ${f.meta ? `<div class="fmeta">${f.meta}</div>` : ""}
      </div>
    </div>`
    )
    .join("");
  const warnHtml = d.warning
    ? `<div class="warnbox"><span class="wi">⚠</span><p><b>Attenzione:</b> ${esc(d.warning)}</p></div>`
    : "";
  sections.result.innerHTML = `
    <div class="restop"><span class="again" id="again-top">↺ Analizza un altro sito</span></div>
    ${warnHtml}
    <div class="hero">
      <div>
        <div class="score">${Number(d.score)}<sup>/100</sup></div>
        <div class="grade" style="color:${gradeColor(d.score)}">${esc(d.grade)}</div>
        <div class="rurl">${esc(d.url)}</div>
      </div>
      <img class="shot" src="${esc(d.shotB64)}" alt="${esc(d.host)}">
    </div>
    <div class="verdetto">
      <span class="eyebrow accent">Il verdetto</span>
      <p>${d.verdetto}</p>
    </div>
    <div class="findings">${fhtml}</div>
    <div class="resfoot">
      <span class="eyebrow">E adesso?</span>
      <h2>Questi problemi si sistemano.</h2>
      <p class="sub" style="margin-top:0">Scope chiuso, prezzo fisso. Nessun preventivo infinito.</p>
      <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;margin-top:28px;text-decoration:none">Parliamone → pionio.it</a>
    </div>`;
  $("#again-top").addEventListener("click", reset);
  show("result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function reset() { show("landing"); $("#url").value = ""; $("#err").textContent = ""; }

async function audit(url) {
  $("#err").textContent = "";
  $("#ltarget").textContent = url;
  show("loading"); runLoadingAnim();
  try {
    const r = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await r.json();
    stopLoadingAnim();
    if (!r.ok) throw new Error(d.error || "Errore");
    await new Promise((res) => setTimeout(res, 500));
    renderResult(d);
  } catch (e) {
    show("landing");
    $("#err").textContent = "⚠ " + e.message;
  }
}

$("#form").addEventListener("submit", (e) => { e.preventDefault(); const u = $("#url").value.trim(); if (u) audit(u); });
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => audit(c.dataset.url)));
