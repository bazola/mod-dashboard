// Journey panel: the way in to one character's whole record (journey-full.js, plans/42).
//
// The dock is 360px wide and a journey runs to a thousand entries, so the record itself lives full
// screen. This panel is the door: the character selected on the map, then whoever has the most to
// read, and a search across everyone who has a journey at all.
//
// Unlike every other panel here, this one lists characters who are offline. A journey is a record of
// what has already happened, and the /bots snapshot every other view is built on can only show who is
// in the world at this moment.
import { state, on, emit } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { num, plural, CLASSES } from "../lib/format.js";
import { avatar, empty } from "./common.js";

const LIMIT = 60;

function row(p, selected) {
  return h("button.row", { type: "button", class: p.guid === selected ? "sel" : "",
    title: `Read ${p.name}'s journey`,
    on: { click: () => emit("open-journey", { guid: p.guid }) } },
    avatar({ class: p.cls }),
    h("span.row-main",
      h("span.row-name", { class: p.bot ? "" : "is-real" }, p.name),
      h("span.row-sub", `Level ${p.level} ${CLASSES[p.cls] || ""}`)),
    h("span.row-end", plural(p.n, "entry", "entries")));
}

export function mountJourney(panel) {
  const open = h("div.np-open",
    h("button.btn.btn-primary", { type: "button", title: "Everything one character has done, in order",
      on: { click: () => emit("open-journey", {}) } }, icon("route", 15), "Open Journey"));
  const meta = h("div.meta", icon("route", 13), "Waiting for the journeys…");
  const input = h("input.input", { type: "search", placeholder: "Find a character", autocomplete: "off",
    spellcheck: "false", "aria-label": "Find a character with a journey" });
  const list = h("div.list");
  const note = h("div.jy-panel-note",
    "Deeds, party talk, what their companions came away feeling, and what they still remember — "
    + "laid out in the order it happened. Characters who are offline are here too.");
  panel.append(open, meta, h("div.field", icon("search", 15), input), list, note);

  input.addEventListener("input", draw);
  input.addEventListener("keydown", e => {
    if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; draw(); }
  });

  function draw() {
    const idx = state.journeys;
    if (!idx) {
      meta.replaceChildren(icon("route", 13), "Waiting for the journeys…");
      render(list, "none", () => empty("regard.py writes these every ten minutes.", "route"));
      return;
    }
    const people = idx.people || [];
    const total = people.reduce((n, p) => n + p.n, 0);
    meta.replaceChildren(icon("route", 13), `${num(people.length)} journeys · ${num(total)} entries`);

    const q = input.value.trim().toLowerCase();
    const match = q ? people.filter(p => p.name.toLowerCase().includes(q)) : people;
    // Whoever is selected on the map comes first, so the panel answers "this one" before "the biggest".
    const here = !q && state.selected != null ? people.find(p => p.guid === state.selected) : null;
    const rest = (here ? match.filter(p => p.guid !== here.guid) : match).slice(0, LIMIT);

    const sig = [q, state.selected, idx.generated, rest.length].join("|");
    render(list, sig, () => !match.length
      ? empty(`Nobody called “${input.value.trim()}” has a journey.`, "route")
      : [
          here && [h("div.group-label", h("span", "Selected"), h("span", "1")), row(here, state.selected)],
          h("div.group-label", h("span", q ? "Matches" : "Most to read"), h("span", num(match.length))),
          rest.map(p => row(p, state.selected)),
          match.length > rest.length + (here ? 1 : 0)
            && h("div.more", `and ${num(match.length - rest.length - (here ? 1 : 0))} more — search by name`),
        ]);
  }

  on("journeys selection", draw);
  draw();
}
