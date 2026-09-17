// Chronicle reader (plan 19): the scribes' watches laid out like a broadsheet, one in-world day per edition.
// Opened from the Chronicle panel. #chronicle in the address opens it on load, so it can live in a tab of its own.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, full, plural, capital } from "../lib/format.js";
import { FACTIONS, when, stories, setChronicleFaction } from "./chronicle.js";
import { empty } from "./common.js";

const HASH = "#chronicle";

// "The fourth day, the small hours" → ["The fourth day", "the small hours"]
function parts(title) {
  const i = title.indexOf(",");
  return i < 0 ? [title.trim(), ""] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

// Newest day first; each day keyed by its first watch, which stays put as later watches are written.
function editions(entries) {
  const out = [];
  for (const e of [...entries].sort((a, b) => b.start - a.start)) {
    const day = parts(e.title)[0];
    const last = out[out.length - 1];
    if (last?.day === day) last.entries.push(e);
    else out.push({ day, entries: [e] });
  }
  for (const d of out) d.key = String(d.entries[d.entries.length - 1].start);
  return out;
}

function article(e, lead) {
  const [day, watch] = parts(e.title);
  const enemy = FACTIONS.find(([id]) => id !== e.faction)[1];
  const tales = e.tales || [];
  const ours = stories(tales, "ours"), heard = stories(tales, "enemy");
  const word = ours.length > 0 || heard.length > 0;
  return h("article.np-article", { class: lead ? "lead" : "" },
    h("header.np-art-head",
      h("div.np-kicker", h("time", { title: full(e.start) }, `${when(e.start)} – ${clock(e.end)}`)),
      h("h2.np-headline", capital(watch || day)),
      h("div.np-by", `By ${e.scribe}`, e.flag && h("span.badge.warn", { title: e.flag }, "judge flag"))),
    h("div.np-body", e.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => h("p", p))),
    word && h("aside.np-word",
      ours.length > 0 && [h("h3", "Word going around"), ours],
      heard.length > 0 && [h("h3", `Word of the ${enemy}`), heard]));
}

export function mountChronicleReader(root) {
  let edition = null;   // key of the day being read; null follows the newest
  let back = null;      // focus to restore on close
  const app = document.getElementById("app");

  const seg = h("div.seg", FACTIONS.map(([id, name]) =>
    h("button", { type: "button", class: name.toLowerCase(), dataset: { f: id }, on: { click: () => setChronicleFaction(id) } }, name)));
  const earlier = h("button.icon-btn", { type: "button", title: "Earlier day (←)", on: { click: () => step(1) } }, icon("left", 18));
  const later = h("button.icon-btn", { type: "button", title: "Later day (→)", on: { click: () => step(-1) } }, icon("right", 18));
  const days = h("select.input.np-days", { "aria-label": "Day", on: { change: () => go(days.value) } });
  const tab = h("button.icon-btn", { type: "button", title: "Open in a new tab",
    on: { click: () => window.open(location.pathname + location.search + HASH, "_blank", "noopener") } }, icon("external", 17));
  const close = h("button.icon-btn", { type: "button", title: "Close (Esc)", on: { click: hide } }, icon("x", 18));
  const sheet = h("div.np-sheet");
  const overlay = h("div.np-overlay", { role: "dialog", "aria-modal": "true", "aria-label": "The Chronicle", tabindex: "-1", hidden: true },
    h("div.np-bar",
      h("div.np-bar-title", icon("book", 17), "The Chronicle"),
      seg,
      h("div.np-nav", earlier, days, later),
      h("div.np-bar-end", tab, close)),
    sheet);
  root.append(overlay);

  const list = () => editions((state.chronicle?.entries || []).filter(e => e.faction === state.chronicleFaction));
  const current = eds => eds.find(d => d.key === edition) || eds[0];

  function go(key) {
    const eds = list();
    edition = key === eds[0]?.key ? null : key;
    draw();
    overlay.scrollTop = 0;
  }

  function step(d) {
    const eds = list();
    const next = eds[eds.indexOf(current(eds)) + d];
    if (next) go(next.key);
  }

  function page(ch, f, eds, i) {
    if (!ch) return empty("Waiting for the chronicle…", "scroll");
    const s = ch.scribes[f];
    const ed = eds[i];
    const [lead, ...rest] = ed ? ed.entries : [];
    const prev = eds[i + 1], next = eds[i - 1];
    const turn = (d, label, cls) => h(`button.np-turn${cls}`, { type: "button", on: { click: () => go(d.key) } },
      cls === ".earlier" && icon("left", 18), h("span", h("small", label), d.day), cls === ".later" && icon("right", 18));
    return [
      h("header.np-mast",
        h("div.np-eyebrow", "Living Azeroth"),
        h("h1.np-name", `The ${FACTIONS.find(([id]) => id === f)[1]} Chronicle`),
        s && h("div.np-about", `Kept by ${s.name}, ${s.about}.`),
        h("div.np-strip",
          h("span", ed ? ed.day : "No watches yet"),
          ed && h("span", plural(ed.entries.length, "watch", "watches")),
          h("span", `Updated ${clock(ch.generated)}`))),
      ed ? [
        article(lead, true),
        rest.length > 0 && h("div.np-rest", { class: rest.length === 1 ? "one" : "" }, rest.map(e => article(e, false))),
        h("footer.np-foot",
          prev ? turn(prev, "Earlier", ".earlier") : h("span"),
          next ? turn(next, "Later", ".later") : h("span")),
      ] : empty("No watches written yet.", "scroll"),
    ];
  }

  function draw() {
    if (overlay.hidden) return;
    const f = state.chronicleFaction;
    const ch = state.chronicle;
    overlay.classList.toggle("horde", f === "H");
    for (const b of seg.children) b.classList.toggle("on", b.dataset.f === f);
    const eds = list();
    const i = Math.max(0, eds.indexOf(current(eds)));
    earlier.disabled = i >= eds.length - 1;
    later.disabled = i <= 0;
    render(days, `${f}|${ch?.generated}`, () => eds.map(d => h("option", { value: d.key }, d.day)));
    days.disabled = eds.length < 2;
    if (eds[i]) days.value = eds[i].key;
    render(sheet, `${f}|${ch?.generated}|${eds[i]?.key}`, () => page(ch, f, eds, i));
  }

  function show() {
    if (!overlay.hidden) return;
    back = document.activeElement;
    edition = null;
    overlay.hidden = false;
    if (app) app.inert = true;
    if (location.hash !== HASH) history.replaceState(null, "", HASH);
    draw();
    overlay.scrollTop = 0;
    overlay.focus();
  }

  function hide() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (app) app.inert = false;
    if (location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
    back?.focus?.();
  }

  // While open, keys belong to the reader: Esc closes, ← and → turn the day, and the dashboard's own keys stay quiet.
  window.addEventListener("keydown", e => {
    if (overlay.hidden) return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); hide(); }
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest?.("select, input, textarea")) {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? 1 : -1);
    }
  }, true);
  window.addEventListener("hashchange", () => location.hash === HASH ? show() : hide());

  on("chronicle chronicle-faction", draw);
  on("open-chronicle", show);
  if (location.hash === HASH) show();
}
