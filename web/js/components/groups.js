// Groups panel: the companies of bots standing together in the world right now.
// The dock is 360px wide, so the wall of companies and the map live full screen in groups-grid.js; this
// panel is the way in, and a compact list of who is standing with whom.
import { state, on, emit } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { plural } from "../lib/format.js";
import { empty, avatar } from "./common.js";
import { groupsNow, markSeen, ageWords, ageKey, linesFor, placeOf, together } from "../lib/groups.js";

function row(g) {
  const lines = linesFor(g);
  return h("button.row", { type: "button", title: "Open this company on the map",
    on: { click: () => emit("open-groups", { key: g.key }) } },
    avatar(g.members[0]),
    h("span.row-main",
      h("span.row-name", g.members.map(p => p.name).join(" & ")),
      h("span.row-sub", `${placeOf(g)}${together(g) ? "" : " (apart)"}`)),
    h("span.gr-row-end",
      h("span.gr-age", ageWords(g.since)),
      h("span", lines.length ? plural(lines.length, "line") : "no talk")));
}

export function mountGroups(panel) {
  const openWall = h("div.np-open",
    h("button.btn.btn-primary", { type: "button", title: "Every company as a wall of cards, with their talk",
      on: { click: () => emit("open-groups") } }, icon("handshake", 15), "Open Companies"));
  const meta = h("div.meta", icon("users", 13), "Waiting for the first snapshot…");
  const list = h("div.list");
  panel.append(openWall, meta, list);

  function draw() {
    const groups = markSeen(groupsNow());
    const bots = groups.reduce((n, g) => n + g.members.length, 0);
    meta.replaceChildren(icon("users", 13),
      groups.length ? `${plural(groups.length, "company", "companies")} · ${plural(bots, "bot")}` : "Nobody is grouped");
    const sig = groups.map(g => `${g.key}:${ageKey(g.since)}:${placeOf(g)}:${linesFor(g).length}`).join("|")
      + `|${state.players.length > 0}`;
    render(list, sig, () => groups.length ? groups.map(row)
      : empty(state.players.length ? "No bots are standing together right now." : "Waiting for the first snapshot…", "handshake"));
  }

  on("snapshot chat", draw);
  draw();
}
