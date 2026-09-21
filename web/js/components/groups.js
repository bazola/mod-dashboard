// Groups panel: the companies of bots standing together in the world right now.
// The dock is 360px wide, so the wall of companies and the map live full screen in groups-grid.js; this
// panel is the way in, and a compact list of who is standing with whom.
import { state, on, emit } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { plural } from "../lib/format.js";
import { empty, avatar } from "./common.js";
import { groupsNow, markSeen, ageWords, ageKey, linesSplit, placeOf, together,
         spread, SAY_DISTANCE } from "../lib/groups.js";

// The count is this company's own talk. Lines said in other companies are counted apart, because a bot
// carries its whole history with it and "13 lines" against a pair that has never spoken to each other
// is the wrong thing to say.
function row(g) {
  const { all, after } = linesSplit(g);
  const yd = Math.round(spread(g));
  const place = together(g)
    ? placeOf(g) + (yd > SAY_DISTANCE ? ` · ${yd} yd apart` : "")
    : placeOf(g) + " · apart";
  return h("button.row", { type: "button", title: "Open this company on the map",
    on: { click: () => emit("open-groups", { key: g.key }) } },
    avatar(g.members[0]),
    h("span.row-main",
      h("span.row-name", g.members.map(p => p.name).join(" & ")),
      h("span.row-sub", place)),
    h("span.gr-row-end",
      h("span.gr-age", ageWords(g.since)),
      h("span", after.length ? plural(after.length, "line")
        : all.length ? `${all.length} earlier` : "no talk")));
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
    const talking = groups.filter(g => linesSplit(g).after.length).length;
    meta.replaceChildren(icon("users", 13), groups.length
      ? `${plural(groups.length, "company", "companies")} · ${plural(bots, "bot")} · ${talking} talking`
      : "Nobody is grouped");
    const sig = groups.map(g => {
      const { all, after } = linesSplit(g);
      return `${g.key}:${ageKey(g.since)}:${placeOf(g)}:${all.length}:${after.length}:${spread(g) > SAY_DISTANCE}`;
    }).join("|") + `|${state.players.length > 0}`;
    render(list, sig, () => groups.length ? groups.map(row)
      : empty(state.players.length ? "No bots are standing together right now." : "Waiting for the first snapshot…", "handshake"));
  }

  on("snapshot chat", draw);
  draw();
}
