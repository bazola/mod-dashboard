// Small building blocks shared by the panels and the inspector.
import { localGet, localSet } from "../state.js";
import { h, icon } from "../lib/dom.js";
import { CLASSES, CLASS_COLORS, full, stamp, signed } from "../lib/format.js";
import { STATE_LABEL, stateOf, scoreClass, companyColor, companyName } from "../lib/world.js";
import { goTo, selectCompany } from "../actions.js";

// A collapsible card with a header and a count. Its open state survives reloads when given a key.
// `expand` puts a button in the header for opening the same thing full screen; it must not toggle
// the card, hence stopping the click before the <summary> under it ever sees it.
export function section(title, { icon: ic, key, open = true, flat = false, expand, expandTitle = "Show all" } = {}) {
  const count = h("span.sect-count");
  const body = h("div.sect-body");
  const button = expand && h("button.icon-btn.sect-expand", { type: "button", title: expandTitle,
    on: { click: e => { e.preventDefault(); e.stopPropagation(); expand(); } } }, icon("expand", 13));
  const el = h("details.sect", { class: flat ? "flat" : "", open },
    h("summary.sect-head", ic && icon(ic, 14), h("span", title), h("span.sect-end", count, button, icon("chevron", 14))),
    body);
  if (key) {
    const saved = localGet("sect." + key);
    if (saved !== null) el.open = saved === "1";
    el.addEventListener("toggle", () => localSet("sect." + key, el.open ? "1" : "0"));
  }
  return { el, body, count: n => { count.textContent = n == null ? "" : String(n); } };
}

export const who = (name, guid) =>
  h("button.who", { type: "button", on: { click: e => { e.stopPropagation(); goTo(guid, name); } } }, name);

export const swatch = gid => h("i.swatch", { style: { background: companyColor(gid) } });

export const companyLink = gid =>
  h("button.who", { type: "button", on: { click: e => { e.stopPropagation(); selectCompany(gid); } } }, swatch(gid), companyName(gid));

export const factionBadge = f => h("span.badge", { class: f === "Horde" ? "horde" : "alliance" }, f);

export const statePill = p => { const st = stateOf(p); return h("span.pill", { class: "st-" + st }, h("i.dot"), STATE_LABEL[st]); };

export const avatar = (p, cls = "") =>
  h("span.avatar", { class: cls, title: CLASSES[p.class] || "", style: { "--cc": CLASS_COLORS[p.class] || "var(--ink-3)" } }, (CLASSES[p.class] || "?")[0]);

export const time = ts => h("time.ts", { title: full(ts) }, stamp(ts));

export const empty = (text, ic = "sparkle") => h("div.empty", icon(ic, 18), h("span", text));

export const kpis = items => h("div.kpis", items.filter(Boolean).map(([label, value, cls]) => h("div.kpi", { class: cls || "" }, h("b", String(value)), h("span", label))));

export const delta = d => h("span.delta", { class: scoreClass(d * 10) }, signed(d));

// Diverging meter for a feeling or stance in −max … +max; the gray midpoint is "nothing either way".
export function dmeter(value, max = 100) {
  const v = Math.max(-max, Math.min(max, value));
  const pct = Math.abs(v) / max * 50 + "%";
  return h("div.dmeter", { class: scoreClass(value), title: signed(value), role: "img", "aria-label": `score ${signed(value)}` },
    h("span.dmeter-mid"),
    h("span.dmeter-fill", { style: v >= 0 ? { left: "50%", width: pct } : { right: "50%", width: pct } }));
}

// Remember which <details> were open across a re-render, keyed by data-key.
export const openKeys = box => new Set([...box.querySelectorAll("details[open]")].map(d => d.dataset.key));
