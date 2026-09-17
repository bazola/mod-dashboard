// Chronicle panel (chronicler.py, plan 19): each faction scribe's watches and the rumours going around.
import { state, on, emit, localSet } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, full } from "../lib/format.js";
import { empty, openKeys } from "./common.js";

export const FACTIONS = [["A", "Alliance"], ["H", "Horde"]];
const HOPS = ["", "Carried on", "Further still", "Far and wide"];
export const when = ts => new Date(ts * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

// A story is told where it happened, then retold at each stop along the road (chronicle_tale, round two).
function story(tellings) {
  return h("div.tale", tellings.map(t => h(`p.rumour.hop${Math.min(t.hop, 3)}`, { title: `told ${when(t.told)}` },
    h("b", t.hop === 0 ? `${t.origin}: ` : `${HOPS[Math.min(t.hop, 3)]}${t.places.length ? ` (${t.places.join(", ")})` : ""}: `),
    `“${t.words}”`)));
}

export function stories(tales, kind) {
  const byRoot = new Map();
  for (const t of tales) if (t.kind === kind) byRoot.set(t.root, [...(byRoot.get(t.root) || []), t]);
  return [...byRoot.values()].map(ts => story(ts.sort((a, b) => a.hop - b.hop)));
}

function entry(e, open) {
  const key = `${e.faction}${e.start}`;
  const tales = e.tales || [];
  const enemy = FACTIONS.find(([id]) => id !== e.faction)[1];
  const ours = stories(tales, "ours"), heard = stories(tales, "enemy");
  return h("details.card.entry", { dataset: { key }, open },
    h("summary",
      h("div.card-main", h("div.entry-title", e.title), h("div.card-sub", { title: full(e.start) }, `${when(e.start)} – ${clock(e.end)}`)),
      icon("chevron", 14)),
    h("div.entry-body",
      h("div.entry-by", icon("feather", 13), e.scribe, e.flag && h("span.badge.warn", { title: "Judge flag kept for review" }, `flag: ${e.flag}`)),
      h("div.prose", e.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => h("p", p))),
      ours.length > 0 && h("div.rumours", h("h4", "Word going around"), ours),
      heard.length > 0 && h("div.rumours.hearsay", h("h4", `Word of the ${enemy}`), heard)));
}

// Shared by the panel and the reader, so both follow the same scribe.
export function setChronicleFaction(id) {
  state.chronicleFaction = id;
  localSet("chronicle", id);
  emit("chronicle-faction");
}

export function mountChronicle(panel) {
  const read = h("div.np-open",
    h("button.btn.btn-primary", { type: "button", title: "Read the chronicle full screen, laid out like a broadsheet", on: { click: () => emit("open-chronicle") } },
      icon("book", 15), "Open Chronicle"),
    h("button.btn", { type: "button", title: "Only what your main and alts took part in, written up watch by watch", on: { click: () => emit("open-chronicle", { mine: true }) } },
      icon("feather", 15), "Your Chronicle"));
  const seg = h("div.seg.full", FACTIONS.map(([id, name]) =>
    h("button", { type: "button", class: name.toLowerCase(), dataset: { f: id }, on: { click: () => setChronicleFaction(id) } }, name)));
  const scribe = h("div");
  const meta = h("div.meta", icon("scroll", 13), "Waiting for the chronicle…");
  const entries = h("div");
  panel.append(read, seg, scribe, meta, entries);

  function draw() {
    const f = state.chronicleFaction;
    for (const b of seg.children) b.classList.toggle("on", b.dataset.f === f);
    const ch = state.chronicle;
    if (!ch) return;
    const s = ch.scribes[f];
    const mine = ch.entries.filter(e => e.faction === f);
    render(scribe, `${f}|${s?.name}|${s?.about}`, () => s && h("div.scribe", { class: f === "H" ? "horde" : "" },
      h("span.seal", icon("feather", 18)),
      h("div", h("div.scribe-name", s.name), h("div.scribe-about", s.about))));
    meta.replaceChildren(icon("scroll", 13), `${mine.length} watches · updated ${clock(ch.generated)}`);
    const fresh = entries.dataset.faction !== f;
    const open = openKeys(entries);
    entries.dataset.faction = f;
    render(entries, `${f}|${ch.generated}`, () => mine.length
      ? mine.map((e, i) => entry(e, fresh ? i === 0 : open.has(`${e.faction}${e.start}`)))
      : empty("No watches written yet.", "scroll"));
  }

  on("chronicle chronicle-faction", draw);
  draw();
}
