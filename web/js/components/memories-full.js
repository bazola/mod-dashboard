// Every memory the society holds, whole and full screen, for reading the lot rather than the head of it.
// The panel shows the newest 40; here there is no head. #memories in the address opens it on load, so it
// can live in a tab of its own. Rows are drawn by the panel's own renderer, so the two never drift apart.
//
// Built to the same shape as feelings-full.js -- one archive file, grown a page at a time as the foot of
// the list comes into view, filtered in memory, Esc to close.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { num } from "../lib/format.js";
import { loadArchive } from "../api.js";
import { empty } from "./common.js";
import { memoryRow } from "./memories.js";

const PAGE = 120;   // rows added each time the foot of the list comes into view
const FILE = "memories-all";
const HASH = "#memories";

// The archive is arrays beside a name table; rows become the objects the renderer expects only for the
// ones actually drawn. Heaviest first, the order the module itself recalls them in.
const rowOf = (names, r) => ({ guid: r[0], name: names[r[0]], importance: r[1], ts: r[2], text: r[3] });

export function mountMemoriesFull(root) {
  let back = null;         // focus to restore on close
  let query = "";
  let rows = [];
  let drawn = 0;
  let cache = { key: "" };
  let typing = null;
  const app = document.getElementById("app");

  const meta = h("div.meta.fx-meta");
  const search = h("input.input.fx-search", { type: "search", "aria-label": "Filter these memories",
    placeholder: "Find a name, a place or a word remembered…",
    on: { input: () => { clearTimeout(typing); typing = setTimeout(filter, 120); } } });
  const again = h("button.icon-btn", { type: "button", title: "Read the file again",
    on: { click: () => loadArchive(FILE, true) } }, icon("activity", 16));
  const newTab = h("button.icon-btn", { type: "button", title: "Open in a new tab",
    on: { click: () => window.open(location.pathname + location.search + HASH, "_blank", "noopener") } },
    icon("external", 17));
  const close = h("button.icon-btn", { type: "button", title: "Close (Esc)", on: { click: hide } }, icon("x", 18));

  const list = h("div.fx-list");
  const foot = h("div.fx-foot");
  const scroll = h("div.fx-scroll", list, foot);
  const overlay = h("div.fx-overlay", { role: "dialog", "aria-modal": "true", "aria-label": "Every memory", tabindex: "-1", hidden: true },
    h("div.fx-bar",
      h("div.fx-bar-title", icon("book", 17), "Memories"),
      meta,
      search,
      h("div.fx-bar-end", again, newTab, close)),
    scroll);
  root.append(overlay);

  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) grow(); }, { root: scroll, rootMargin: "800px" });

  function source() {
    const held = state.archive.get(FILE);
    const d = held?.doc;
    if (!d) return null;
    const key = `${d.generated}`;
    if (cache.key === key) return cache;
    const n = d.names;
    cache = { key, all: d.rows, text: r => `${n[r[0]]} ${r[3]}`, node: r => memoryRow(rowOf(n, r)) };
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
    render(foot, `${cache.key}|${query}|${drawn}|${rows.length}`, () => left > 0
      ? h("button.btn.fx-more", { type: "button", on: { click: grow } }, `Show ${num(Math.min(left, PAGE))} more · ${num(left)} still below`)
      : rows.length > 0 && h("div.fx-end", `That is all ${num(rows.length)}.`));
  }

  function filter() {
    const src = source();
    query = search.value.trim().toLowerCase();
    if (!src) {
      rows = []; drawn = 0;
      const held = state.archive.get(FILE);
      list.replaceChildren(empty(held?.failed ? "Those memories could not be read." : "Reading every memory…", "book"));
      tail();
      return count(null);
    }
    rows = query ? src.all.filter(r => src.text(r).toLowerCase().includes(query)) : src.all;
    drawn = 0;
    list.replaceChildren();
    if (!rows.length) { list.append(empty(query ? `Nothing here matches “${search.value.trim()}”.` : "Nobody has remembered anything yet.", "book")); tail(); }
    else grow();
    count(src.all.length);
    scroll.scrollTop = 0;
  }

  function count(total) {
    const many = n => `${num(n)} ${n === 1 ? "memory" : "memories"}`;
    render(meta, `${total}|${rows.length}|${query}`, () => total == null ? "Reading…"
      : query ? `${num(rows.length)} of ${many(total)} match` : many(total));
  }

  function show() {
    if (!overlay.hidden) return;
    back = document.activeElement;
    overlay.hidden = false;
    if (app) app.inert = true;
    io.observe(foot);
    if (location.hash !== HASH) history.replaceState(null, "", HASH);
    search.value = "";
    loadArchive(FILE);
    filter();
    overlay.focus();
  }

  function hide() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    io.unobserve(foot);
    if (app) app.inert = false;
    if (location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
    back?.focus?.();
  }

  // A name in these rows still goes to that character, and the inspector is behind this: get out of the way.
  scroll.addEventListener("click", e => { if (e.target.closest?.(".who")) hide(); });

  window.addEventListener("keydown", e => {
    if (overlay.hidden) return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); hide(); }
  }, true);

  const fromHash = () => location.hash === HASH ? show() : hide();
  window.addEventListener("hashchange", fromHash);

  // Deliberately not refetched every cycle: that would throw the reader back to the top every two minutes.
  // Opening it again picks up a newer file, and so does the button.
  on("archive", name => { if (!overlay.hidden && name === FILE) filter(); });
  on("open-memories", show);
  if (location.hash === HASH) fromHash();
}
