// Feelings panel (regard.py): recent moments, overheard talk (plan 18 P8c), warmest and coldest ties.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, num, signed, capital } from "../lib/format.js";
import { scoreClass } from "../lib/world.js";
import { section, who, time, empty, kpis, delta, dmeter, openKeys } from "./common.js";

const SOURCE_WORDS = { chat: "in chat", talk: "overheard", event: "an event" };

function moment(r) {
  const warm = r.delta > 0;
  return h("div.tl",
    h("span.tl-icon", { class: warm ? "warm" : "cold" }, icon(warm ? "up" : "down", 14)),
    h("div.tl-line", who(r.feeler_name, r.feeler), h("span.muted", warm ? " warmed to " : " cooled on "), who(r.about_name, r.about), delta(r.delta)),
    h("span", { title: SOURCE_WORDS[r.source] || r.source }, time(r.ts)),
    h("div.tl-text", r.reason));
}

function talk(t, open) {
  const key = `${t.ts}${t.a}${t.b}`;
  return h("details.card", { dataset: { key }, open: open.has(key) },
    h("summary",
      h("span.tl-icon", icon("message", 14)),
      h("div.card-main", h("div.talk-names", `${t.a} & ${t.b}`), h("div.card-sub", capital(t.place))),
      time(t.ts),
      icon("chevron", 14)),
    h("div.talk-body",
      t.exchange.map(([speaker, line]) => h("div.bubble", { class: speaker === t.a ? "a" : "b" }, h("b", speaker), line)),
      t.moments.length > 0 && h("div.moments", t.moments.map(m =>
        h("div.moment", delta(m.feels), h("span", `${m.target} ${m.feels > 0 ? "warmed to" : m.feels < 0 ? "cooled on" : "noted"} ${m.speaker}: ${m.why}`))))));
}

function tie(t) {
  return h("div.tie",
    h("div.tie-head", who(t.feeler_name, t.feeler), h("span.arrow", "→"), who(t.about_name, t.about), h("span.score", { class: scoreClass(t.score) }, signed(t.score))),
    h("div.tie-words", capital(t.words.replace(/^you /, "")), h("span.muted", ` · ${t.familiarity} moments`)),
    dmeter(t.score));
}

export function mountFeelings(panel) {
  const meta = h("div.meta", icon("activity", 13), "Waiting for regard data…");
  const stats = h("div");
  const recent = section("Recent moments", { icon: "activity", key: "f.recent" });
  const overheard = section("Overheard", { icon: "message", key: "f.talk" });
  const warmest = section("Warmest ties", { icon: "up", key: "f.warm" });
  const coldest = section("Coldest ties", { icon: "down", key: "f.cold" });
  panel.append(meta, stats, recent.el, overheard.el, warmest.el, coldest.el);

  on("regard", () => {
    const r = state.regard;
    meta.replaceChildren(icon("activity", 13), `Updated ${clock(r.generated)}`);
    render(stats, `${r.pairs}|${r.moments_day}|${(r.talks || []).length}`, () =>
      kpis([["ties", num(r.pairs)], ["moments today", num(r.moments_day)], ["overheard", (r.talks || []).length]]));

    const moments = r.recent.slice(0, 25);
    recent.count(moments.length);
    render(recent.body, `${r.generated}`, () => moments.length ? moments.map(moment) : empty("No moments yet.", "activity"));

    const talks = r.talks || [];
    overheard.count(talks.length);
    const open = openKeys(overheard.body);
    render(overheard.body, `${r.generated}`, () => talks.length ? talks.map(t => talk(t, open)) : empty("No one has been overheard yet.", "message"));

    const warm = r.warmest.filter(t => t.score > 0).slice(0, 10);
    const cold = r.coldest.filter(t => t.score < 0).slice(0, 10);
    warmest.count(warm.length);
    coldest.count(cold.length);
    render(warmest.body, `${r.generated}`, () => warm.length ? warm.map(tie) : empty("No warm ties yet.", "heart"));
    render(coldest.body, `${r.generated}`, () => cold.length ? cold.map(tie) : empty("No cold ties yet.", "heart"));
  });
}
