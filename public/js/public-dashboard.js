/* ---------------------------------------------------------------------------
   Public progress view — what the site's home page shows to a visitor who is
   not signed in.

   This module is deliberately standalone: it does not import api.js or
   store.js and it never touches /api/*. Those endpoints stay behind
   Cloudflare Access; this view is served to anyone with the link, so it reads
   only from /live/data (counts) and /live/events (a sanitised change ping).

   If you find yourself needing a record id, a name, or a staff email to
   render something here, that is the signal to stop rather than to widen
   /live/data. See src/public_dashboard.ts and CLAUDE.md.
--------------------------------------------------------------------------- */

/* Wording matches the staff dashboard so the two read as one system. Per
   CLAUDE.md, official ECI terminology stays untranslated in both languages. */
const I18N = {
  en: {
    sub: "Live verification progress",
    loading: "Loading…",
    live: "Live",
    reconnecting: "Reconnecting…",
    offline: "Can't reach the server",
    signIn: "Staff sign in",
    revisedTotal: "Revised Total",
    revisedFormula: "Found on base roll + Additions − Deletions",
    baseTotal: "Base Roll Total",
    completed: "Verification Completed",
    pending: "Pending",
    additions: "Additions",
    deletions: "Deletions",
    corrections: "Corrections",
    percent: "% Complete",
    progressTitle: "Verification Progress",
    found: "Found",
    notFound: "Not Found",
    todayTitle: "Activity Today",
    todayVerifications: "Verifications",
    todayNone: "No activity recorded yet today.",
    partsTitle: "Coverage by Part",
    partCol: "Part",
    partColBase: "Base Roll",
    partColDone: "Done",
    partColAdditions: "Additions",
    partColDeletions: "Deletions",
    partColCorrections: "Corrections",
    updated: "Last updated",
    noticeTitle: "About this page",
    notice:
      "This is a public summary of an ongoing door-to-door verification of the electoral roll. It shows counts only. No names, addresses, ages, EPIC numbers or any other personal details of voters or surveyors are published here, and none can be reached from this page. Figures update automatically as surveyors submit their work in the field, and may change as entries are reviewed.",
    signInHint: "Survey staff: sign in to record verifications and see the full dashboard.",
    defs: {
      revised_total:
        "What the roll should contain once this audit is applied: base roll voters confirmed Found, plus field additions, minus deletions.",
      base_roll_total:
        "Voters in the original electoral roll as imported from the ECI CSV. This is the baseline the audit measures against and does not change as verification proceeds.",
      verification_completed:
        "Roll entries where a surveyor has recorded an outcome, either Found or Not Found.",
      pending: "Roll entries still waiting to be verified. Base Roll Total minus Verification Completed.",
      additions: "Eligible voters found living in the area who are missing from the roll, recorded in the field.",
      deletions:
        "Voters who were verified and are marked for deletion, for reasons such as death, marriage, or other grounds recorded by the surveyor.",
      corrections: "Voters who were found but whose roll details are wrong, and who need a Form 8 correction.",
    },
  },
  hi: {
    sub: "सत्यापन प्रगति — लाइव",
    loading: "लोड हो रहा है…",
    live: "लाइव",
    reconnecting: "फिर से जुड़ रहे हैं…",
    offline: "सर्वर से संपर्क नहीं हो पा रहा",
    signIn: "स्टाफ लॉगिन",
    revisedTotal: "संशोधित कुल",
    revisedFormula: "मूल सूची में मिले + जोड़े गए − हटाए गए",
    baseTotal: "मूल सूची कुल",
    completed: "सत्यापन पूर्ण",
    pending: "लंबित",
    additions: "जोड़े गए",
    deletions: "हटाए गए",
    corrections: "सुधार",
    percent: "% पूर्ण",
    progressTitle: "सत्यापन प्रगति",
    found: "मिले",
    notFound: "नहीं मिले",
    todayTitle: "आज की गतिविधि",
    todayVerifications: "सत्यापन",
    todayNone: "आज अभी तक कोई गतिविधि दर्ज नहीं हुई।",
    partsTitle: "भाग अनुसार प्रगति",
    partCol: "भाग",
    partColBase: "मूल सूची",
    partColDone: "पूर्ण",
    partColAdditions: "जोड़े गए",
    partColDeletions: "हटाए गए",
    partColCorrections: "सुधार",
    updated: "अंतिम अद्यतन",
    noticeTitle: "इस पृष्ठ के बारे में",
    notice:
      "यह मतदाता सूची के चल रहे घर-घर सत्यापन का सार्वजनिक सारांश है। इसमें केवल संख्याएँ दिखाई जाती हैं। किसी मतदाता या सर्वेक्षक का नाम, पता, आयु, EPIC नंबर या कोई अन्य व्यक्तिगत विवरण यहाँ प्रकाशित नहीं किया गया है और न ही इस पृष्ठ से देखा जा सकता है। सर्वेक्षकों द्वारा फील्ड में काम दर्ज करते ही आँकड़े अपने आप अद्यतन होते हैं।",
    signInHint: "सर्वेक्षण स्टाफ: सत्यापन दर्ज करने और पूरा डैशबोर्ड देखने के लिए लॉगिन करें।",
    defs: {
      revised_total:
        "इस ऑडिट के बाद सूची में क्या होना चाहिए: मूल सूची में मिले मतदाता, फील्ड में जोड़े गए, हटाए गए घटाकर।",
      base_roll_total:
        "ECI CSV से आयातित मूल मतदाता सूची में मतदाता। यह वह आधार है जिससे ऑडिट की तुलना की जाती है।",
      verification_completed: "वे प्रविष्टियाँ जिनका सर्वेक्षक ने परिणाम दर्ज किया — मिला या नहीं मिला।",
      pending: "वे प्रविष्टियाँ जिनका सत्यापन बाकी है। मूल सूची कुल में से सत्यापन पूर्ण घटाकर।",
      additions: "क्षेत्र में रहने वाले वे पात्र मतदाता जो सूची में नहीं हैं, फील्ड में दर्ज किए गए।",
      deletions:
        "वे मतदाता जिनका सत्यापन हो गया है और जिन्हें हटाने के लिए चिह्नित किया गया है, जैसे मृत्यु, विवाह या अन्य कारणों से।",
      corrections: "वे मतदाता जो मिले पर जिनका विवरण गलत है और जिन्हें Form 8 सुधार चाहिए।",
    },
  },
};

let lang = "en";
let container = null;
let latest = null;
let previous = null;
let socket = null;
let refetchTimer = null;
let pollTimer = null;

function t(key) {
  return (I18N[lang] || I18N.en)[key];
}
function num(n) {
  return (n == null ? 0 : n).toLocaleString("en-IN");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function setStatus(kind) {
  const pill = document.getElementById("statusPill");
  if (!pill) return;
  pill.className = "status-pill " + (kind === "live" ? "online" : kind === "down" ? "offline" : "syncing");
  pill.textContent = kind === "live" ? t("live") : kind === "down" ? t("offline") : t("reconnecting");
}

/* A value that moved since the last render gets a brief highlight, so someone
   watching the page notices progress without having to diff the numbers. */
function changed(path) {
  if (!previous) return "";
  let a = previous;
  let b = latest;
  for (const part of path.split(".")) {
    a = a && a[part];
    b = b && b[part];
  }
  return a !== undefined && a !== b ? " flash" : "";
}

function statCard(path, value, label, def, opts = {}) {
  return `
    <div class="dash-stat${opts.headline ? " headline" : ""}${changed(path)}">
      <b>${value}</b><span class="dash-label">${esc(label)}</span>
      ${opts.formula ? `<div class="dash-formula">${esc(opts.formula)}</div>` : ""}
      ${def ? `<div class="dash-def">${esc(def)}</div>` : ""}
    </div>`;
}

function render() {
  if (!container || !latest) return;
  const d = latest.totals;
  const defs = (I18N[lang] || I18N.en).defs;
  const today = latest.today;
  const todayTotal = today.verifications + today.additions + today.deletions + today.corrections;

  container.innerHTML = `
    <div class="signin-bar">
      <span>${esc(t("signInHint"))}</span>
      <button onclick="window.location.href='/api/signin'">${esc(t("signIn"))}</button>
    </div>

    <div class="dash-grid">
      ${statCard("totals.revised_total", num(d.revised_total), t("revisedTotal"), defs.revised_total, {
        headline: true,
        formula: t("revisedFormula"),
      })}
      ${statCard("totals.base_roll_total", num(d.base_roll_total), t("baseTotal"), defs.base_roll_total)}
      ${statCard("totals.verification_completed", num(d.verification_completed), t("completed"), defs.verification_completed)}
      ${statCard("totals.pending", num(d.pending), t("pending"), defs.pending)}
      ${statCard("totals.additions", num(d.additions), t("additions"), defs.additions)}
      ${statCard("totals.deletions", num(d.deletions), t("deletions"), defs.deletions)}
      ${statCard("totals.corrections", num(d.corrections), t("corrections"), defs.corrections)}
      ${statCard("totals.percent_complete", d.percent_complete + "%", t("percent"), null)}
    </div>

    <div class="section-title">${esc(t("progressTitle"))}</div>
    <div class="progress-bar"><span style="width:${Math.min(100, d.percent_complete)}%"></span></div>
    <div class="row">
      <div><b>${num(d.found)}</b> ${esc(t("found"))}</div>
      <div><b>${num(d.not_found)}</b> ${esc(t("notFound"))}</div>
      <div><b>${num(d.pending)}</b> ${esc(t("pending"))}</div>
    </div>

    <div class="section-title">${esc(t("todayTitle"))} — ${esc(today.date)}</div>
    ${
      todayTotal
        ? `<div class="dash-grid">
            ${statCard("today.verifications", num(today.verifications), t("todayVerifications"), null)}
            ${statCard("today.additions", num(today.additions), t("additions"), null)}
            ${statCard("today.deletions", num(today.deletions), t("deletions"), null)}
            ${statCard("today.corrections", num(today.corrections), t("corrections"), null)}
          </div>`
        : `<div class="empty">${esc(t("todayNone"))}</div>`
    }

    <div class="section-title">${esc(t("partsTitle"))}</div>
    <table class="parts">
      <thead><tr>
        <th>${esc(t("partCol"))}</th><th>${esc(t("partColBase"))}</th><th>${esc(t("partColDone"))}</th>
        <th>${esc(t("partColAdditions"))}</th><th>${esc(t("partColDeletions"))}</th><th>${esc(t("partColCorrections"))}</th>
      </tr></thead>
      <tbody>
        ${latest.parts
          .map(
            (p) => `<tr>
              <td>${esc(p.part_number)}</td><td>${num(p.base_total)}</td><td>${num(p.done)}</td>
              <td>${num(p.additions)}</td><td>${num(p.deletions)}</td><td>${num(p.corrections)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>

    <div class="notice"><b>${esc(t("noticeTitle"))}</b><br>${esc(t("notice"))}</div>
    <div class="foot">${esc(t("updated"))}: ${esc(
      new Date(latest.generated_at).toLocaleString({ hi: "hi-IN", te: "te-IN" }[lang] || "en-IN")
    )}</div>
  `;
}

async function load() {
  try {
    const res = await fetch("/live/data", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    previous = latest;
    latest = await res.json();
    render();
    setStatus(socket && socket.readyState === 1 ? "live" : "stale");
  } catch (e) {
    setStatus("down");
    if (!latest && container) {
      container.innerHTML = `<div class="empty">${esc(t("loading"))}</div>`;
    }
  }
}

/* A burst of field submissions would otherwise trigger one refetch per event.
   Coalesce them, with jitter so many open viewers don't hit the Worker on the
   same tick. */
function scheduleRefetch() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    load();
  }, 400 + Math.random() * 600);
}

function connectLive() {
  if (socket) return;
  try {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${location.host}/live/events`);
    socket.onopen = () => {
      setStatus("live");
      load();
    };
    // Payload is {event, at} only — treat it purely as "something changed"
    // and go back to /live/data for the numbers.
    socket.onmessage = () => scheduleRefetch();
    socket.onclose = () => {
      socket = null;
      setStatus("stale");
      setTimeout(connectLive, 5000);
    };
    socket.onerror = () => socket && socket.close();
  } catch (e) {
    socket = null;
    setStatus("down");
    setTimeout(connectLive, 5000);
  }
}

export function setPublicLang(next) {
  lang = I18N[next] ? next : "en";
  const sub = document.getElementById("t-sub");
  if (sub) sub.textContent = t("sub");
  render();
}

export function startPublicDashboard(el, initialLang) {
  container = el;
  lang = I18N[initialLang] ? initialLang : "en";
  const sub = document.getElementById("t-sub");
  if (sub) sub.textContent = t("sub");
  container.innerHTML = `<div class="empty">${esc(t("loading"))}</div>`;
  load();
  connectLive();
  // Safety net: if the socket dies quietly (phone sleeps, proxy drops it) the
  // figures still refresh rather than sitting stale with a "Live" pill.
  if (!pollTimer) pollTimer = setInterval(load, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
}
