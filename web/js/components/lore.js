// Lore panel (lore_gate.py, plan 28): a player writes their own characters' lore, and the world checks it.
// The gate lives on its own port because this server caps bodies at 1024 bytes and never answers a preflight.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { section, empty } from "./common.js";

const GATE = `${location.protocol}//${location.hostname}:8788`;
const WHAT = { main: "sheet", alt: "backstory", player: "sheet" };

// The gate's token is its own secret, not the dashboard's command token.
const readToken = () => { try { return localStorage.getItem("dash.loreToken") || ""; } catch { return ""; } };
const saveToken = v => { try { localStorage.setItem("dash.loreToken", v); } catch {} };

let chosen = null;      // character name
let result = null;      // the gate's last answer
let busy = false;

async function ask(path, body) {
  const res = await fetch(GATE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Lore-Token": readToken() },
    body: JSON.stringify(body),
  });
  return res.json();
}

const who = c => h("div.lore-who",
  h("b", c.name),
  h("span.muted", ` ${c.race} ${c.cls}`),
  c.bond_kind ? h("span.pill", c.bond_kind) : null);

// What a character already has, so the gaps are obvious at a glance.
const marks = c => h("div.lore-marks",
  ["sheet", "story", "traits"].map(k => h("span.mark", { class: c[`has_${k}`] ? "on" : "" },
    icon(c[`has_${k}`] ? "up" : "down", 12), k)));

function list(doc, redraw) {
  const rows = (doc.characters || []).filter(c => c.kind !== "player" || c.has_story);
  if (!rows.length) return empty("No characters of yours yet. Name a main first.");
  return h("div.lore-list", rows.map(c => h("button.lore-row", {
    type: "button",
    class: c.name === chosen ? "on" : "",
    on: { click: () => { chosen = c.name; result = null; redraw(); } },
  }, who(c), marks(c))));
}

function verdict(r) {
  if (!r) return null;
  const bad = (r.refusals || []).length;
  return h("div.lore-verdict",
    r.message ? h("div.lore-msg", r.message) : null,
    bad ? h("div.lore-bad", h("h4", "This cannot stand in the world"),
      h("ul", r.refusals.map(x => h("li", x)))) : null,
    (r.advice || []).length ? h("div.lore-advice", h("h4", "Worth considering"),
      h("ul", r.advice.map(x => h("li", x)))) : null,
    r.prose ? h("div.lore-prose", h("h4", "As the world would tell it"), h("p", r.prose)) : null,
    (r.stale_bonds || []).length
      ? h("div.lore-advice", h("h4", "Now out of date"),
          h("p", `${r.stale_bonds.join(", ")} — their ties were written from the older sheet.`))
      : null,
    r.note ? h("div.muted.lore-note", r.note) : null);
}

export function mountLore(el) {
  const draw = () => {
    const doc = state.loreEdit;
    render(el, JSON.stringify([doc?.generated, chosen, result, busy]), () => {
      if (!doc) return [empty("The lore gate has not published yet.")];

      const token = h("input.input", {
        type: "password", placeholder: "Lore gate token", autocomplete: "off",
        spellcheck: "false", value: readToken(),
        on: { change: e => saveToken(e.target.value.trim()) },
      });

      const char = (doc.characters || []).find(c => c.name === chosen);
      const what = char ? (WHAT[char.kind] || "backstory") : null;
      const existing = char ? (what === "sheet" ? char.sheet_source : char.story_source) : "";
      const box = h("textarea.lore-box", {
        rows: 10, spellcheck: "true",
        placeholder: char
          ? `Write ${char.name} in your own words: where they come from, what they are like, what they are after.`
          : "Choose a character first.",
      });
      if (existing) box.value = existing;

      const run = async (path) => {
        if (busy || !char) return;
        busy = true; draw();
        try {
          result = await ask(path, {
            character: char.name, what, text: box.value.trim(),
            prose: path === "/commit" ? (result && result.prose) || "" : "",
          });
        } catch (e) {
          result = { ok: false, message: `The gate did not answer (${e.message}). Is wow-lore-gate running?` };
        } finally { busy = false; draw(); }
      };

      const check = h("button.btn.btn-primary", {
        type: "button", disabled: !char || busy,
        on: { click: () => run("/draft") },
      }, busy ? "Asking…" : "Check");
      const save = h("button.btn.btn-go", {
        type: "button", disabled: !(result && result.prose) || busy,
        on: { click: () => run("/commit") },
      }, "Keep it");

      // section() hands back { el, body, count } and the content goes inside body -- it is not an array.
      const sec = (title, ...kids) => {
        const s = section(title);
        s.body.append(...kids.filter(Boolean));
        return s.el;
      };
      return [
        sec("Your characters", list(doc, draw)),
        sec("What you say of them",
          char ? h("div.lore-edit", box, h("div.lore-actions", check, save)) : empty("Choose a character."),
          verdict(result)),
        sec("The gate",
          h("div.lore-rules",
            h("ul", [
              "Write as though it is real life. No games, no figures.",
              "Nothing later than this age has happened yet.",
              "Keep to your own people's lands and history.",
              "Your own words are kept — the shaping must not lose what you said.",
            ].map(t => h("li", t)))),
          token),
      ];
    });
  };
  on("loreEdit", draw);
  draw();
}
