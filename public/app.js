// Pionio Audit — front-end. Esterno (non inline) per poter applicare una CSP severa.
const $ = (s) => document.querySelector(s);
const sections = { landing: $("#landing"), loading: $("#loading"), result: $("#result") };
function show(name) { for (const k in sections) sections[k].classList.toggle("active", k === name); }

// escape di tutto ciò che deriva dall'input utente prima di metterlo in innerHTML
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// social riusabili (stessi stili .landing-footer/.soc del footer della home)
const SOCIAL_HTML = `
  <div class="landing-footer" style="margin-top:36px;padding-bottom:0">
    <a class="soc" href="https://www.instagram.com/pionio_dev/" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg></a>
    <a class="soc" href="https://x.com/pionio_dev" target="_blank" rel="noopener" aria-label="X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
  </div>`;

// URL leggibile: via la coda di tracking (?utm_…&gclid=…), tieni host + percorso.
// Evita il muro di caratteri tipo mytheresa.com?dplink=true&utm_source=…&gclid=…
function prettyUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname === "/" ? "" : x.pathname.replace(/\/$/, "");
    return x.host + path;
  } catch { return String(u).split("?")[0]; }
}

const sevDot = { critico: "var(--danger)", attenzione: "var(--warn)", ok: "var(--accent-300)" };
const sevLabel = { critico: "CRITICO", attenzione: "DA GUARDARE", ok: "✓ A POSTO" };

let stepTimer, noteTimer, lastResult = null;
// su mobile possiamo condividere il file direttamente (share sheet di sistema)
const canShareFiles = (() => {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([""], "t.png", { type: "image/png" })] })
      && matchMedia("(pointer: coarse)").matches); // solo touch/mobile → desktop scarica
  } catch { return false; }
})();
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
        ${SOCIAL_HTML}
      </div>`;
    $("#again-top").addEventListener("click", reset);
    show("result"); window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  // MURO ANTI-BOT (Cloudflare & simili) → niente punteggio, lo diciamo onestamente
  if (d.warningType === "challenge") {
    sections.result.innerHTML = `
      <div class="restop"><span class="again" id="again-top">↺ Analizza un altro sito</span></div>
      <div class="platformcard">
        <img class="pemoji" src="/brand/pmark.png" alt="">
        <h2>Questo sito è protetto da un muro anti-bot</h2>
        <p>${esc(d.warning)}</p>
        <p style="opacity:.7">Riprova con un altro sito, o controlla il tuo — se non è dietro a un sistema così, lo misuro senza problemi.</p>
        ${SOCIAL_HTML}
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

  // il finale si adatta: numero di problemi reali → messaggio specifico (converte meglio)
  const nProblems = worse.findings.filter((f) => f.sev !== "ok").length;
  const positive = worse.score >= 90; // ≥90 → tono positivo (coerente col verdetto), niente conteggio
  const findingsLabel = nProblems > 0 ? `Cosa puoi migliorare · ${worseLabel}` : `Quello che abbiamo controllato · ${worseLabel}`;
  const footHtml = !positive
    ? `<div class="resfoot">
        <span class="eyebrow">E adesso?</span>
        <h2>${nProblems === 1 ? "C'è 1 cosa che ti costa clienti." : `Ci sono ${nProblems} cose che ti costano clienti.`}</h2>
        <p class="sub" style="margin-top:0">Le sistemiamo noi — lavoro definito, prezzo fisso. Nessun preventivo infinito.</p>
        <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;margin-top:28px;text-decoration:none">Parliamone → pionio.it</a>
        ${SOCIAL_HTML}
      </div>`
    : `<div class="resfoot">
        <span class="eyebrow">Niente da segnalare</span>
        <h2>Questo sito è messo bene.</h2>
        <p class="sub" style="margin-top:0">Veloce e in ordine — complimenti. Se vuoi spingerlo ancora più in là, o ne hai un altro che arranca, ci siamo.</p>
        <a class="cta" href="https://pionio.it" style="display:inline-block;line-height:62px;margin-top:28px;text-decoration:none">Parliamone → pionio.it</a>
        ${SOCIAL_HTML}
      </div>`;

  sections.result.innerHTML = `
    <div class="restop"><span class="again" id="again-top">↺ Analizza un altro sito</span><span class="again" id="export-btn">${canShareFiles ? "↗ Condividi report" : "↓ Scarica report"}</span></div>
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
    <div class="rurl">${esc(prettyUrl(d.url))}</div>
    <div class="verdetto">
      <span class="eyebrow accent">Il verdetto</span>
      <p>${worse.verdetto}</p>
    </div>
    <div class="eyebrow" style="margin:0 0 14px 4px">${findingsLabel}</div>
    <div class="findings">${findingsHtml(worse.findings)}</div>
    ${footHtml}`;
  lastResult = d;
  $("#again-top").addEventListener("click", reset);
  $("#export-btn").addEventListener("click", exportReport);
  show("result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function exportReport() {
  const btn = $("#export-btn");
  if (!btn || !lastResult) return;
  const orig = btn.textContent;
  btn.textContent = "Preparo l'immagine…";
  btn.style.pointerEvents = "none";
  const name = "pionio-audit-" + (lastResult.host || "report") + ".png";
  try {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lastResult),
    });
    if (!r.ok) throw new Error("export fallito");
    const blob = await r.blob();
    if (canShareFiles) {
      // mobile: apre il menu di condivisione di sistema → IG/Storie/WhatsApp
      const file = new File([blob], name, { type: "image/png" });
      try {
        await navigator.share({ files: [file], title: "Audit Pionio", text: "Audit del sito " + (lastResult.host || "") });
      } catch (e) {
        if (e && e.name !== "AbortError") throw e; // l'utente ha annullato → ok
      }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  } catch {
    btn.textContent = "Errore, riprova";
    setTimeout(() => (btn.textContent = orig), 2000);
    btn.style.pointerEvents = "";
    return;
  }
  btn.textContent = orig;
  btn.style.pointerEvents = "";
}

function reset() { show("landing"); $("#url").value = ""; $("#err").textContent = ""; }

async function audit(url) {
  $("#err").textContent = "";
  $("#ltarget").textContent = prettyUrl(url);
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
    if (window.umami) umami.track("audit_run", { host: d.host || url });
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
