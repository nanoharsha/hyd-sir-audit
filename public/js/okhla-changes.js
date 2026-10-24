/* What changed on an elector's record since the Jan-2025 roll. The roll row keeps the 2025 values; the server adds
   c_* fields (src/okhla.ts, ok_changes): c_fields = what differs on the Draft SIR roll, c_name / c_age / c_gender / c_rel /
   c_house = the draft's printed values, c_mod = monthly modification lists. The card shows the LATEST name (the draft's)
   and lists every change, so nobody is confused by an old name on the roll. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym) => {
  const [y, m] = String(ym).split("-");
  return MONTHS[(parseInt(m, 10) || 1) - 1] + " " + y;
};
const has = (m, f) => (m.c_fields || "").split(",").includes(f);

// the name to show: the draft's when it differs from the 2025 roll
export const latestName = (m) => (has(m, "name") && m.c_name ? m.c_name : m.name);

export function changesHtml(m, t, esc) {
  const rows = [];
  const line = (key, from, to) => rows.push(`<div class="ok-chg-row"><b>${esc(t(key))}</b> ${esc(from || "—")} <span class="arr">→</span> <b>${esc(to || "—")}</b></div>`);
  if (has(m, "name")) line("okChgName", m.name, m.c_name);
  if (has(m, "age")) line("okChgAge", m.age, m.c_age);
  if (has(m, "gender")) line("okChgGender", m.gender, m.c_gender);
  if (has(m, "relative")) line("okChgRel", m.relation_name, m.c_rel);
  if (has(m, "house")) line("okChgHouse", String(m.house_raw || "").split(",")[0].trim(), m.c_house);
  const months = (m.c_mod || "").split(";").filter(Boolean).map(monthName);
  if (months.length) rows.push(`<div class="ok-chg-row"><b>${esc(t("okChgMonthly"))}</b> ${esc(months.join(", "))}</div>`);
  if (!rows.length) return "";
  return `<div class="ok-chg"><div class="ok-chg-hd">${esc(t("okChgHd"))}</div>${rows.join("")}</div>`;
}

// Possible duplicate entries: the same person listed twice on the 2025 roll under two EPICs. Both entries are shown with their own
// status, and the EPIC is a link that opens the other entry. `go` is the global handler that does the opening.
export function twinsHtml(m, t, esc, statusLabel, go) {
  let list = [];
  try {
    list = m.twins ? (typeof m.twins === "string" ? JSON.parse(m.twins) : m.twins) : [];
  } catch (e) {}
  if (!list.length) return "";
  const rows = list
    .map(
      (w) => `<div class="ok-twin-row">
        <a href="#" onclick="${go}('${esc(w.epic || "")}');return false;"><b>${esc(w.epic || t("okNoEpic"))}</b></a>
        <span class="ok-badge s-${esc(w.status)}">${esc(statusLabel(w.status))}</span>
        <span class="muted">${esc([w.rel_type && w.rel ? w.rel_type + " " + w.rel : "", w.detail, `${t("okOldPart")} ${w.part ?? "—"}`, w.new_part ? `${t("okNewPart")} ${w.new_part}` : ""].filter(Boolean).join(" · "))}</span>
      </div>`
    )
    .join("");
  return `<div class="ok-twin"><div class="ok-twin-hd">${esc(t("okTwinHd"))}</div><div class="ok-twin-sub">${esc(t("okTwinSub"))}</div>${rows}</div>`;
}
