// The Feelings panel's four lists, whole and full screen, for checking the scoring row by row.
// The panel shows the head of each -- the latest 25 moments, 15 conversations, ten warm ties, ten cold.
// Here there is no head: every row regard.py has is in the archive files, and every row is reachable.
// #moments, #overheard, #warmest and #coldest in the address open one on load, so each can live in a
// tab of its own. The rows are drawn by the panel's own renderers, so the two never drift apart.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { num } from "../lib/format.js";
import { loadArchive } from "../api.js";
import { empty } from "./common.js";
import { moment, talk, tie } from "./feelings.js";

const PAGE = 120;   // rows added each time the foot of the list comes into view

const VIEWS = {
  moments: { hash: "#moments", label: "Moments", title: "Every moment", icon: "activity", file: "moments",
             one: "moment", none: "No moments yet." },
  overheard: { hash: "#overheard", label: "Overheard", title: "Everything overheard", icon: "message", file: "talks",
               one: "conversation", none: "No one has been overheard yet." },
  warmest: { hash: "#warmest", label: "Warmest", title: "Every warm tie", icon: "up", file: "ranked",
             one: "warm tie", none: "No warm ties yet." },
  coldest: { hash: "#coldest", label: "Coldest", title: "Every cold tie", icon: "down", file: "ranked",
             one: "cold tie", none: "No cold ties yet." },
};

const byHash = hash => Object.keys(VIEWS).find(v => VIEWS[v].hash === hash);
const many = (n, one) => `${num(n)} ${n === 1 ? one : one + "s"}`;

// The archive rows are arrays beside a name table -- 97,000 ties as objects weigh 19 MB. They become
// the objects the panel's renderers expect only for the rows actually drawn.
const momentOf = (names, m) =>
  ({ ts: m[0], feeler: m[1], feeler_name: names[m[1]], about: m[2], about_name: names[m[2]],
     delta: m[3], score: m[4], source: m[5], reason: m[6] });

const tieOf = (names, phrases, t) =>
  ({ feeler: t[0], feeler_name: names[t[0]], about: t[1], about_name: names[t[1]],
     score: t[2], familiarity: t[3], words: phrases[t[4]] });

export function mountFeelingsFull(root) {
  let view = "moments";
  let back = null;         // focus to restore on close
  let query = "";
  let rows = [];           // what the filter left, in the order they are read
  let drawn = 0;           // how many of them are in the list
  let cache = { key: "" }; // the current view's rows, kept across keystrokes
  let typing = null;
  const app = document.getElementById("app");

  const seg = h("div.seg.fx-seg", Object.entries(VIEWS).map(([id, v]) =>
    h("button", { type: "button", dataset: { v: id }, title: v.title, on: { click: () => go(id) } },
      icon(v.icon, 13), h("span", v.label))));
  const meta = h("div.meta.fx-meta");
  const search = h("input.input.fx-search", { type: "search", "aria-label": "Filter these rows",
    on: { input: () => { clearTimeout(typing); typing = setTimeout(filter, 120); } } });
  const again = h("button.icon-btn", { type: "button", title: "Read the file again",
    on: { click: () => loadArchive(VIEWS[view].file, true) } }, icon("activity", 16));
  const newTab = h("button.icon-btn", { type: "button", title: "Open in a new tab",
    on: { click: () => window.open(location.pathname + location.search + VIEWS[view].hash, "_blank", "noopener") } },
    icon("external", 17));
  const close = h("button.icon-btn", { type: "button", title: "Close (Esc)", on: { click: hide } }, icon("x", 18));

  const list = h("div.fx-list");
  const foot = h("div.fx-foot");
  const scroll = h("div.fx-scroll", list, foot);
  const overlay = h("div.fx-overlay", { role: "dialog", "aria-modal": "true", "aria-label": "Feelings in full", tabindex: "-1", hidden: true },
    h("div.fx-bar",
      h("div.fx-bar-title", icon("heart", 17), "Feelings"),
      seg,
      meta,
      search,
      h("div.fx-bar-end", again, newTab, close)),
    scroll);
  root.append(overlay);

  // Grows the list as its foot comes into view: 92,000 rows are all reachable, none drawn before asked for.
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) grow(); }, { root: scroll, rootMargin: "800px" });

  // The rows of the current view, unfiltered, with how to search them and how to draw one.
  function source() {
    const v = VIEWS[view];
    const held = state.archive.get(v.file);
    const d = held?.doc;
    if (!d) return null;
    const key = `${view}|${d.generated}`;
    if (cache.key === key) return cache;
    if (view === "moments") {
      const n = d.names;
      cache = { key, all: d.moments, text: m => `${n[m[1]]} ${n[m[2]]} ${m[6]}`, node: m => moment(momentOf(n, m)) };
    } else if (view === "overheard") {
      const open = new Set();
      cache = { key, all: d.talks, node: t => talk(t, open),
                text: t => `${t.a} ${t.b} ${t.place} ${t.exchange.map(e => e[1]).join(" ")}` };
    } else {
      const n = d.names, p = d.phrases;
      // One ranking, warmest first: the warm view reads it from the top, the cold one from the bottom up.
      const all = view === "warmest" ? d.ties.filter(t => t[2] > 0) : d.ties.filter(t => t[2] < 0).reverse();
      cache = { key, all, text: t => `${n[t[0]]} ${n[t[1]]}`, node: t => tie(tieOf(n, p, t)) };
    }
    return cache;
  }

  function grow() {
    const src = source();
    if (!src || drawn >= rows.length) return;
    const next = rows.slice(drawn, drawn + PAGE);
    list.append(...next.map(src.node));
    drawn += next.length;
    tail();
  }

  function tail() {
    const left = rows.length - drawn;
    render(foot, `${view}|${cache.key}|${query}|${drawn}|${rows.length}`, () => left > 0
      ? h("button.btn.fx-more", { type: "button", on: { click: grow } }, `Show ${num(Math.min(left, PAGE))} more · ${num(left)} still below`)
      : rows.length > 0 && h("div.fx-end", `That is all ${num(rows.length)}.`));
  }

  // Rebuilds the list from the top: a new view, a new archive, or a changed filter.
  function filter() {
    const src = source();
    query = search.value.trim().toLowerCase();
    if (!src) {
      rows = []; drawn = 0;
      const held = state.archive.get(VIEWS[view].file);
      list.replaceChildren(empty(held?.failed ? "That list could not be read." : "Reading every row…", VIEWS[view].icon));
      tail();
      return count(null);
    }
    rows = query ? src.all.filter(r => src.text(r).toLowerCase().includes(query)) : src.all;
    drawn = 0;
    list.replaceChildren();
    if (!rows.length) { list.append(empty(query ? `Nothing here matches “${search.value.trim()}”.` : VIEWS[view].none, VIEWS[view].icon)); tail(); }
    else grow();
    count(src.all.length);
    scroll.scrollTop = 0;
  }

  function count(total) {
    const v = VIEWS[view];
    render(meta, `${view}|${total}|${rows.length}|${query}`, () => total == null ? "Reading…"
      : query ? `${num(rows.length)} of ${many(total, v.one)} match` : many(total, v.one));
  }

  function go(next) {
    if (view === next && !overlay.hidden) return;
    view = next;
    search.value = "";
    search.placeholder = view === "overheard" ? "Find a name, a place or a word said…"
      : view === "moments" ? "Find a name or a reason…" : "Find a name…";
    for (const b of seg.children) b.classList.toggle("on", b.dataset.v === view);
    if (!overlay.hidden && location.hash !== VIEWS[view].hash) history.replaceState(null, "", VIEWS[view].hash);
    loadArchive(VIEWS[view].file);
    filter();
  }

  function show(opts) {
    const next = opts?.view && VIEWS[opts.view] ? opts.view : view;
    if (!overlay.hidden) return go(next);
    back = document.activeElement;
    overlay.hidden = false;
    if (app) app.inert = true;
    io.observe(foot);
    view = null;
    go(next);
    overlay.focus();
  }

  function hide() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    io.unobserve(foot);
    if (app) app.inert = false;
    if (byHash(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    back?.focus?.();
  }

  // A name in these rows still goes to that character, and the inspector is behind this: get out of
  // the way. The button's own handler has already run by the time the click reaches here.
  scroll.addEventListener("click", e => { if (e.target.closest?.(".who")) hide(); });

  // While open, keys belong to this view: Esc closes, and the dashboard's own keys stay quiet.
  window.addEventListener("keydown", e => {
    if (overlay.hidden) return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); hide(); }
  }, true);

  const fromHash = () => byHash(location.hash) ? show({ view: byHash(location.hash) }) : hide();
  window.addEventListener("hashchange", fromHash);

  // Deliberately not refetched on every regard cycle: that would throw the reader back to the top of
  // 92,000 rows every two minutes. Opening the view again picks up a newer file, and so does the button.
  on("archive", name => { if (!overlay.hidden && name === VIEWS[view].file) filter(); });
  on("open-feelings", show);
  if (byHash(location.hash)) fromHash();
}
