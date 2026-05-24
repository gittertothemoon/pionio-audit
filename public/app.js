// Pionio Audit — front-end. Esterno (non inline) per poter applicare una CSP severa.
const $ = (s) => document.querySelector(s);
const sections = { landing: $("#landing"), loading: $("#loading"), result: $("#result") };
function show(name) { for (const k in sections) sections[k].classList.toggle("active", k === name); }

// escape di tutto ciò che deriva dall'input utente prima di metterlo in innerHTML
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sevDot = { critico: "var(--danger)", attenzione: "var(--warn)", ok: "var(--accent-300)" };
const sevLabel = { critico: "CRITICO", attenzione: "DA GUARDARE", ok: "✓ A POSTO" };

let stepTimer, noteTimer;
const LOADING_NOTES = [
  "Stesso metro per tutti i siti.",
  "Misuriamo i byte davvero scaricati, non le stime.",
  "Mobile e desktop, come conta Google.",
  "Soglie ufficiali dei Core Web Vitals.",
  "Niente email, niente registrazione.",
];
function runLoadingAnim() {
  const steps = [...document.querySelectorAll("#lsteps .step")];
  const bar = $("#lbar"); let i = 0;
  steps.forEach((s) => (s.className = "step"));
  // la barra striscia di continuo e rallenta verso il fondo → non sembra mai bloccata
  bar.style.transition = "none"; bar.style.width = "3%";
  requestAnimationFrame(() => {
    bar.style.transition = "width 13s cubic-bezier(.05,.7,.1,1)";
    bar.style.width = "94%";
  });
  const tick = () => {
    if (i > 0) steps[i - 1].className = "step done";
    if (i < steps.length) { steps[i].className = "step now"; i++; }
    // l'ultimo step resta "now" (pulsante) finché non arriva il risultato
    if (i >= steps.length) clearInterval(stepTimer);
  };
  tick(); stepTimer = setInterval(tick, 2600);
  // riga che ruota: dà qualcosa da leggere → l'attesa pesa meno
  const note = $("#lnote"); let n = 0;
  const showNote = () => {
    note.classList.remove("show");
    setTimeout(() => { note.textContent = LOADING_NOTES[n % LOADING_NOTES.length]; note.classList.add("show"); n++; }, 250);
  };
  showNote(); noteTimer = setInterval(showNote, 3200);
}
function stopLoadingAnim() {
  clearInterval(stepTimer); clearInterval(noteTimer);
  document.querySelectorAll("#lsteps .step").forEach((s) => (s.className = "step done"));
  const note = $("#lnote"); if (note) note.classList.remove("show");
  const bar = $("#lbar"); bar.style.transition = "width .4s ease"; bar.style.width = "100%";
}

function gradeColor(score) { return score >= 70 ? "var(--accent-400)" : score >= 50 ? "var(--warn)" : "var(--danger)"; }

function findingsHtml(findings) {
  const order = { critico: 0, attenzione: 1, ok: 2 };
  return [...findings]
    .sort((a, b) => order[a.sev] - order[b.sev])
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
}

function renderResult(d) {
  // SOCIAL / piattaforma → niente punteggio, solo un messaggio gentile
  if (d.warningType === "platform") {
    sections.result.innerHTML = `
      <div class="restop"><span class="again" id="again-top">↺ Analizza un altro sito</span></div>
      <div class="platformcard">
        <img class="pemoji" src="/brand/pmark.png" alt="">
        <h2>Questo è un profilo ${esc(d.platformName)}, non un sito tuo</h2>
        <p>Il nostro audit serve per il sito web che <b>possiedi e gestisci tu</b> — non per i social, dove la pagina è costruita e controllata da loro. Incolla l'indirizzo del tuo sito e ci pensiamo noi.</p>
        <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;text-decoration:none">Non hai ancora un sito? → pionio.it</a>
      </div>`;
    $("#again-top").addEventListener("click", reset);
    show("result"); window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const dk = d.desktop, mb = d.mobile;
  const worse = mb.score <= dk.score ? mb : dk;
  const worseLabel = worse === mb ? "vista mobile" : "vista desktop";

  const egg = d.easterEgg ? `<div class="egg"><img class="egg-mark" src="/brand/pmark.png" alt=""><p>${d.easterEgg}</p></div>` : "";
  const warn = d.warning ? `<div class="warnbox"><span class="wi">⚠</span><p><b>Attenzione:</b> ${esc(d.warning)}</p></div>` : "";

  // il finale si adatta: se non ci sono problemi veri non parliamo di "problemi da sistemare"
  const hasProblems = worse.findings.some((f) => f.sev !== "ok");
  const findingsLabel = hasProblems ? `Cosa puoi migliorare · ${worseLabel}` : `Quello che abbiamo controllato · ${worseLabel}`;
  const footHtml = hasProblems
    ? `<div class="resfoot">
        <span class="eyebrow">E adesso?</span>
        <h2>Questi problemi si sistemano.</h2>
        <p class="sub" style="margin-top:0">Lavoro definito, prezzo fisso. Nessun preventivo infinito.</p>
        <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;margin-top:28px;text-decoration:none">Parliamone → pionio.it</a>
      </div>`
    : `<div class="resfoot">
        <span class="eyebrow">Niente da segnalare</span>
        <h2>Questo sito è messo bene.</h2>
        <p class="sub" style="margin-top:0">Veloce e in ordine — complimenti. Se vuoi spingerlo ancora più in là, o ne hai un altro che arranca, ci siamo.</p>
        <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;margin-top:28px;text-decoration:none">Parliamone → pionio.it</a>
      </div>`;

  sections.result.innerHTML = `
    <div class="restop"><span class="again" id="again-top">↺ Analizza un altro sito</span></div>
    ${egg}
    ${warn}
    <div class="dual">
      <div class="vpcard">
        <span class="vplabel">DESKTOP</span>
        <div class="score">${Number(dk.score)}<sup>/100</sup></div>
        <div class="grade" style="color:${gradeColor(dk.score)}">${esc(dk.grade)}</div>
        <img class="shot" src="${esc(dk.shotB64)}" alt="${esc(d.host)} desktop" style="margin-top:24px">
      </div>
      <div class="vpcard">
        <span class="vplabel">MOBILE</span>
        <div class="score">${Number(mb.score)}<sup>/100</sup></div>
        <div class="grade" style="color:${gradeColor(mb.score)}">${esc(mb.grade)}</div>
        <div class="shot-wrap-mobile" style="margin-top:24px"><img class="shot-mobile" src="${esc(mb.shotB64)}" alt="${esc(d.host)} mobile"></div>
      </div>
    </div>
    <div class="rurl">${esc(d.url)}</div>
    <div class="verdetto">
      <span class="eyebrow accent">Il verdetto</span>
      <p>${worse.verdetto}</p>
    </div>
    <div class="eyebrow" style="margin:0 0 14px 4px">${findingsLabel}</div>
    <div class="findings">${findingsHtml(worse.findings)}</div>
    ${footHtml}`;
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
    renderResult(d);
  } catch (e) {
    show("landing");
    $("#err").textContent = "⚠ " + e.message;
  }
}

// la gente scrive svogliatamente: accettiamo "pionio.it", "www.pionio.it ", "PIONIO.it"…
function normalizeUrl(raw) {
  let u = (raw || "").trim().replace(/\s+/g, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}
$("#form").addEventListener("submit", (e) => { e.preventDefault(); const u = normalizeUrl($("#url").value); if (u) audit(u); });
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => audit(c.dataset.url)));

// gli esempi "Prova:" servono solo in locale per testare → in pubblico li tolgo
if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(location.hostname)) {
  document.querySelector(".chips")?.remove();
}
