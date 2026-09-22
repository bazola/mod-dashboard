// Memories panel (regard.py's memories_snapshot): what the bots still carry, across the whole society.
//
// Two things this deliberately does not show. WHERE a memory happened: the store is
// (bot_guid, memory_text, importance, created_at) and nothing else, so the place survives only as words
// inside the prose, and picking it back out would be guesswork. And importance as colour or weight: on
// this realm 77% of memories are scored 7 or above, so a visual keyed to it comes out nearly flat. It is
// a muted number instead, honest about being almost always high.
//
// The row is Feelings' .tl timeline, unchanged, which is why this panel needs no CSS of its own.
import { state, on, emit } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, num } from "../lib/format.js";
import { section, who, time, empty, kpis } from "./common.js";

export function memoryRow(m) {
  return h("div.tl", { title: `weighed ${m.importance} of 10` },
    h("span.tl-icon", icon("sparkle", 14)),
    h("div.tl-line", who(m.name, m.guid), h("span.muted", " still carries"), h("span.muted", ` · ${m.importance}/10`)),
    time(m.ts),
    h("div.tl-text", m.text));
}

export function holder(t) {
  return h("div.tie",
    h("div.tie-head", who(t.name, t.guid), h("span.muted", `${num(t.held)} ${t.held === 1 ? "memory" : "memories"}`)));
}

export function mountMemories(panel) {
  const meta = h("div.meta", icon("book", 13), "Waiting for the memories…");
  const stats = h("div");
  const whole = { expand: () => emit("open-memories", {}), expandTitle: "Show every one, full screen" };
  const lately = section("Lately remembered", { icon: "sparkle", key: "m.recent", ...whole });
  const deepest = section("Who carries the most", { icon: "book", key: "m.top" });
  panel.append(meta, stats, lately.el, deepest.el);

  on("memories", () => {
    const r = state.memories;
    meta.replaceChildren(icon("book", 13), `Updated ${clock(r.generated)}`);
    render(stats, `${r.total}|${r.bots}|${r.day}|${r.avg}`, () =>
      kpis([["memories", num(r.total)], ["remembering", num(r.bots)],
            ["today", num(r.day)], ["avg weight", r.avg]]));

    const lines = (r.lines || []).slice(0, 40);
    lately.count(lines.length && r.total > lines.length ? `${lines.length} of ${num(r.total)}` : String(lines.length));
    render(lately.body, `${r.generated}`, () =>
      lines.length ? lines.map(memoryRow) : empty("Nobody has remembered anything yet.", "sparkle"));

    const top = r.top || [];
    deepest.count(top.length);
    render(deepest.body, `${r.generated}`, () =>
      top.length ? top.map(holder) : empty("No one carries anything yet.", "book"));
  });
}
