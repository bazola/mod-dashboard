// Chronicle panel (chronicler.py, plan 19): each faction scribe's watches and the rumours going around.
import { state, on, localSet } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, full } from "../lib/format.js";
import { empty, openKeys } from "./common.js";

const FACTIONS = [["A", "Alliance"], ["H", "Horde"]];
const when = ts => new Date(ts * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

function entry(e, open) {
  const key = `${e.faction}${e.start}`;
  const near = e.rumours.filter(r => r.distance === 0);
  const far = new Map();
  for (const r of e.rumours) if (r.distance !== 0) far.set(r.words, [...(far.get(r.words) || []), r.zone_name]);
  return h("details.card.entry", { dataset: { key }, open },
    h("summary",
      h("div.card-main", h("div.entry-title", e.title), h("div.card-sub", { title: full(e.start) }, `${when(e.start)} – ${clock(e.end)}`)),
      icon("chevron", 14)),
    h("div.entry-body",
      h("div.entry-by", icon("feather", 13), e.scribe, e.flag && h("span.badge.warn", { title: "Judge flag kept for review" }, `flag: ${e.flag}`)),
      h("div.prose", e.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => h("p", p))),
      e.rumours.length > 0 && h("div.rumours",
        h("h4", "Word going around"),
        near.map(r => h("p.rumour", h("b", `${r.zone_name}: `), `“${r.words}”`)),
        [...far].map(([words, places]) => h("p.rumour", h("b", `Told further off (${places.join(", ")}): `), `“${words}”`)))));
}

export function mountChronicle(panel) {
  const seg = h("div.seg.full", FACTIONS.map(([id, name]) =>
    h("button", { type: "button", class: name.toLowerCase(), dataset: { f: id }, on: { click: () => { state.chronicleFaction = id; localSet("chronicle", id); draw(); } } }, name)));
  const scribe = h("div");
  const meta = h("div.meta", icon("scroll", 13), "Waiting for the chronicle…");
  const entries = h("div");
  panel.append(seg, scribe, meta, entries);

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

  on("chronicle", draw);
  draw();
}
