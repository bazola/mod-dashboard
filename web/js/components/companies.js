// Companies panel (regard.py, plan 14 and 18): the companies, candidacies, fallen companies, incidents.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, full, plural } from "../lib/format.js";
import { scoreClass, companyColor } from "../lib/world.js";
import { selectCompany } from "../actions.js";
import { section, companyLink, time, empty, kpis } from "./common.js";

const CAUSE_WORDS = { disbanded: "broke apart", vanished: "gone without word", orphaned: "remnants found" };
const STAGE_WORDS = { noticed: "noticed", spoken_for: "spoken for", offered: "offered a place", joined: "sworn in" };
const PENDING_WORDS = { invite: "be invited", promote: "be raised", demote: "be lowered", remove: "be cast out" };
export const KIND_WORDS = { claimed: "Claimed", taken: "Taken", held: "Held", contested: "Contested", same_prey: "Same prey" };
const KIND_ICONS = { claimed: "flag", taken: "crown", held: "shield", contested: "swords", same_prey: "compass" };

export function incident(i) {
  const cls = scoreClass(i.delta * 10);
  return h("div.tl.click", { title: `${KIND_WORDS[i.kind] || i.kind}${i.delta ? ` · stance ${i.delta > 0 ? "+" : ""}${i.delta}` : ""}`, on: { click: () => selectCompany(i.a) } },
    h("span.tl-icon", { class: cls }, icon(KIND_ICONS[i.kind] || "flag", 14)),
    h("div.tl-line", h("b", KIND_WORDS[i.kind] || i.kind)),
    time(i.ts),
    h("div.tl-text", i.detail));
}

function companyRow(gid, c) {
  return h("button.row", { type: "button", class: state.selectedCompany === gid ? "sel" : "", on: { click: () => selectCompany(gid) } },
    h("span.avatar", { style: { "--cc": companyColor(gid) } }, icon("shield", 14)),
    h("span.row-main",
      h("span.row-name", c.name),
      h("span.row-sub", `holds ${c.holds.length} · contests ${c.contests.length} · ${plural(c.seats.length, "seat")}`)));
}

function candidacyRow(c) {
  const bits = [STAGE_WORDS[c.stage] || c.stage];
  if (c.rank_name) bits[0] += ` as ${c.rank_name}`;
  if (c.sponsor_name) bits.push(`sponsor ${c.sponsor_name}`);
  if (c.blackball_name) bits.push(`opposed by ${c.blackball_name}`);
  if (c.pending) bits.push(`waiting to ${PENDING_WORDS[c.pending] || c.pending}`);   // plan 18 P4
  return h("div.tl", { title: `${c.vouchers} vouching · standing ${c.standing} · since ${full(c.since)}` },
    h("span.tl-icon", { class: scoreClass(c.standing) }, icon("handshake", 14)),
    h("div.tl-line", h("b", c.player_name), h("span.muted", " → "), companyLink(c.guildid)),
    h("span"),
    h("div.tl-text", bits.join(" · ")));
}

function fallen(e) {
  return h("div.tl", { title: `was id ${e.guildid} · archived as ended #${e.ended_id}` },
    h("span.tl-icon.cold", icon("flag", 14)),
    h("div.tl-line", h("b", e.name || `company #${e.guildid}`)),
    time(e.ended_at),
    h("div.tl-text", `${CAUSE_WORDS[e.cause] || e.cause} · ${plural(e.members, "last member")}`));
}

export function mountCompanies(panel) {
  const meta = h("div.meta", icon("shield", 13), "Waiting for company data…");
  const stats = h("div");
  const list = section("Companies", { icon: "shield", key: "c.list" });
  const cands = section("Candidacies", { icon: "handshake", key: "c.cand" });
  const ended = section("Fallen companies", { icon: "flag", key: "c.ended", open: false });
  const incidents = section("Recent incidents", { icon: "swords", key: "c.inc" });
  panel.append(meta, stats, list.el, cands.el, ended.el, incidents.el);

  function draw() {
    const co = state.companies;
    if (!co) return;
    const entries = Object.entries(co.companies).map(([id, c]) => [Number(id), c]);
    const held = Object.values(co.lands).filter(l => l.holder).length;
    const contested = Object.values(co.lands).filter(l => l.challenger).length;
    meta.replaceChildren(icon("shield", 13), `Updated ${clock(co.generated)}`);
    render(stats, `${co.generated}`, () => kpis([["companies", entries.length], ["lands held", held], ["contested", contested, contested ? "cold" : ""], ["relations", co.relations.length]]));

    list.count(entries.length);
    render(list.body, `${co.generated}|${state.selectedCompany}|${state.theme}`, () => ["Alliance", "Horde"].map(faction => {
      const mine = entries.filter(([, c]) => c.faction === faction).sort(([, a], [, b]) => a.name.localeCompare(b.name));
      return mine.length > 0 && [h("div.group-label", h("span", faction), h("span", mine.length)), h("div.list", mine.map(([gid, c]) => companyRow(gid, c)))];
    }));

    const candidacy = co.candidacy || [];
    cands.count(candidacy.length);
    render(cands.body, `${co.generated}|${state.theme}`, () => candidacy.length ? candidacy.map(candidacyRow) : empty("No company has taken notice of anyone yet.", "handshake"));

    const gone = co.ended || [];
    ended.count(gone.length);
    render(ended.body, `${co.generated}`, () => gone.length ? gone.map(fallen) : empty("No company has fallen.", "flag"));

    const recent = co.incidents.slice(0, 25);
    incidents.count(recent.length);
    render(incidents.body, `${co.generated}`, () => recent.length ? recent.map(incident) : empty("Nothing has happened between companies yet.", "swords"));
  }

  on("companies selection theme", draw);
}
