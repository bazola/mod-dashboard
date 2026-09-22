// The companies of bots as a wall of cards, full screen over the dashboard, and one company on the map.
// Opened from the Groups panel; #groups in the address opens it on load, so it can live in a tab of its own.
// Clicking a card opens that company: its members on the map, highlighted, with their talk beneath.
import { state, on } from "../state.js";
import { h, icon, render, esc } from "../lib/dom.js";
import { stamp, full, plural, CLASSES, CLASS_COLORS } from "../lib/format.js";
import { where, factionOf, describe } from "../lib/world.js";
import { avatar, empty, factionBadge } from "./common.js";
import { groupsNow, markSeen, ageWords, ageKey, linesFor, linesSplit, saidBy, placeOf, together,
         spread, SAY_DISTANCE } from "../lib/groups.js";
import { select } from "../actions.js";

const HASH = "#groups";
const CARD_LINES = 60;   // a card shows the tail of the talk; the modal shows all of it

// WoW world axes: +x is north, +y is west. Leaflet lat grows north, lng east. (mapview.js says the same;
// two lines, kept local rather than exported across components.)
const toLatLng = (x, y) => [x, -y];
const areaBounds = a => L.latLngBounds(toLatLng(a.bottom, a.left), toLatLng(a.top, a.right));

const names = g => g.members.map(p => p.name).join(" & ");

// ---- Talk ----

function bubble(g, l, past) {
  const side = l.guid === g.members[0].guid ? "a" : "b";
  return h("div.bubble", { class: past ? `${side} past` : side },
    h("b", `${l.name} · ${stamp(l.ts)}`), l.text);
}

// Oldest first, in two labelled halves. chat.json is keyed by speaker and knows nothing of groups, so the
// earlier half was said in other companies -- to other companions, or to a real player -- and is always
// named and dimmed as such. When a company has said nothing of its own, say so outright: silence read as
// a one-sided conversation is exactly how this first went wrong.
function chatBody(g, before, after) {
  if (!before.length && !after.length) {
    return empty(g.members.length === 2 ? "Neither of them has ever spoken." : "None of them has ever spoken.", "message");
  }
  const out = [];
  if (before.length) {
    out.push(h("div.gr-since", `earlier · ${plural(before.length, "line")} said in other companies`));
    out.push(before.map(l => bubble(g, l, true)));
  }
  if (after.length) {
    if (before.length) out.push(h("div.gr-since", "since they joined up"));
    out.push(after.map(l => bubble(g, l)));
  } else {
    out.push(h("div.gr-note", "Nothing said since they joined up."));
  }
  return out;
}

const toBottom = el => { el.scrollTop = el.scrollHeight; };

// ---- A card ----

// A member who has never said anything is worth naming as silent: an empty column looks like a bug.
function member(p, leader, said) {
  return h("div.gr-member",
    avatar(p),
    h("span.gr-who", { class: p.guid === leader ? "lead" : "" }, p.name),
    h("span.muted", `${p.level} ${CLASSES[p.class] || ""}`),
    h("span.gr-said", { class: said ? "" : "none" }, said ? plural(said, "line") : "silent"),
    h("span.gr-mzone", where(p) || "—"));
}

// How far apart they stand, when that is the reason they are not talking.
function farBadge(g) {
  const yd = Math.round(spread(g));
  if (yd <= SAY_DISTANCE) return null;
  return h("span.badge.warn", { title: `The widest gap between any two members. Party chat has no range, so this does not stop them talking -- it is how to tell a company travelling together from one strung out across a zone` }, `${yd} yd apart`);
}

function card(g, onOpen) {
  const { all, before, after } = linesSplit(g);
  const chat = h("div.gr-chat", chatBody(g, before.slice(-CARD_LINES), after.slice(-CARD_LINES)));
  const el = h("div.gr-card", { role: "button", tabindex: "0",
    title: "Open this company on the map",
    on: { click: () => onOpen(g.key), keydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(g.key); } } } },
    h("div.gr-card-head",
      h("div.gr-names",
        h("div.gr-name-line", h("span.gr-who", names(g)), factionBadge(factionOf(g.members[0]))),
        h("div.gr-card-sub", `${plural(g.members.length, "bot")} · levels ${g.members.map(p => p.level).join(", ")}`)),
      h("div.gr-stat",
        h("span.gr-age", { title: `Standing together since ${full(g.since / 1000)}, as first seen by the dashboard` }, ageWords(g.since)),
        h("span.muted", after.length ? plural(after.length, "line")
          : all.length ? `${all.length} earlier` : "no talk"))),
    h("div.gr-where", icon(together(g) ? "pin" : "swords", 13), placeOf(g),
      !together(g) ? h("span.badge.warn", "apart") : farBadge(g)),
    h("div.gr-members", g.members.map(p => member(p, g.leader, saidBy(g, p)))),
    chat);
  queueMicrotask(() => toBottom(chat));
  return el;
}

export function mountGroupsGrid(root) {
  let back = null;        // focus to restore on close
  let openKey = null;     // the company shown in the modal, if any
  let map = null;         // the modal's Leaflet map, built on first open
  let layers = null;
  const app = document.getElementById("app");

  // ---- The wall ----
  const count = h("span.meta");
  const grid = h("div.gr-grid");
  const scroll = h("div.gr-scroll", grid);
  const overlay = h("div.gr-overlay", { role: "dialog", "aria-modal": "true", "aria-label": "Companies of bots", tabindex: "-1", hidden: true },
    h("div.gr-bar",
      h("div.gr-bar-title", icon("handshake", 17), "Companies"),
      count,
      h("div.gr-bar-end",
        h("button.icon-btn", { type: "button", title: "Open in a new tab",
          on: { click: () => window.open(location.pathname + location.search + HASH, "_blank", "noopener") } }, icon("external", 17)),
        h("button.icon-btn", { type: "button", title: "Close (Esc)", on: { click: hide } }, icon("x", 18)))),
    scroll);

  // ---- One company ----
  const mapEl = h("div.gr-map");
  const sheetTitle = h("div.gr-sheet-title");
  const sheetSub = h("div.card-sub");
  const sheetTags = h("div.gr-sheet-tags");
  const modalChat = h("div.gr-modal-chat");
  const modal = h("div.gr-modal", { role: "dialog", "aria-modal": "true", "aria-label": "A company on the map", hidden: true,
    on: { click: e => { if (e.target === modal) closeOne(); } } },
    h("div.gr-sheet",
      h("div.gr-sheet-head",
        h("div", { style: { flex: "1", "min-width": "0" } }, sheetTitle, sheetSub, sheetTags),
        h("button.icon-btn", { type: "button", title: "Back to the wall (Esc)", on: { click: closeOne } }, icon("x", 18))),
      h("div.gr-sheet-body", mapEl, modalChat)));

  root.append(overlay, modal);

  const groups = () => markSeen(groupsNow());
  const find = key => groups().find(g => g.key === key);

  // ---- The modal's map ----

  function ensureMap() {
    if (map || !window.L) return map;
    map = L.map(mapEl, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5,
      attributionControl: false, zoomControl: true });
    for (const [name, z] of [["art", 210], ["zoneart", 220], ["zones", 380], ["dots", 420]]) map.createPane(name).style.zIndex = z;
    layers = {
      art: L.layerGroup().addTo(map),
      zones: L.layerGroup().addTo(map),
      dots: L.layerGroup().addTo(map),
      zoneRenderer: L.svg({ pane: "zones" }),
      dotRenderer: L.svg({ pane: "dots" }),
    };
    return map;
  }

  function drawMap(g) {
    if (!ensureMap()) {
      mapEl.replaceChildren(h("div.map-error", icon("alert", 18), "The map library could not load."));
      return;
    }
    for (const k of ["art", "zones", "dots"]) layers[k].clearLayers();

    // The company's own map: the leader's, or the first member standing outdoors.
    const outdoors = g.members.filter(p => !p.instance);
    const anchor = outdoors.find(p => p.guid === g.leader) || outdoors[0];
    if (!anchor) {
      mapEl.classList.add("none");
      return;
    }
    mapEl.classList.remove("none");
    const mapId = String(anchor.map);
    const here = g.members.filter(p => !p.instance && String(p.map) === mapId);

    for (const a of state.mapArt.filter(a => String(a.map) === mapId && !a.zone)) {
      L.imageOverlay("maps/" + a.file, areaBounds(a), { interactive: false, pane: "art" }).addTo(layers.art);
    }
    // Zone art only for the zones they are actually in: the modal is about them, not the continent.
    const theirZones = new Set(here.map(p => p.zone));
    for (const a of state.mapArt.filter(a => String(a.map) === mapId && theirZones.has(a.zone))) {
      L.imageOverlay("maps/" + a.file, areaBounds(a), { interactive: false, pane: "zoneart" }).addTo(layers.art);
    }

    let fit = null;
    for (const z of (state.worldmap?.zones || [])) {
      if (String(z.map) !== mapId) continue;
      const zb = areaBounds(z);
      if (theirZones.has(z.zone)) fit = fit ? fit.extend(zb) : zb;
      L.rectangle(zb, { renderer: layers.zoneRenderer, color: "rgba(160,174,192,.28)", weight: 1, fill: false, interactive: false }).addTo(layers.zones);
      L.marker(zb.getCenter(), { icon: L.divIcon({ className: "zone-anchor", iconSize: [0, 0] }), interactive: false, keyboard: false })
        .bindTooltip(esc(z.name), { permanent: true, direction: "center", className: "zone-label" })
        .addTo(layers.zones);
    }

    // Everyone else on this map, dim and small, so the company can be seen standing among them.
    for (const p of state.players) {
      if (p.instance || String(p.map) !== mapId || here.includes(p)) continue;
      L.circleMarker(toLatLng(p.x, p.y), { renderer: layers.dotRenderer, radius: 3, weight: 0,
        fillColor: "#6f7a8c", fillOpacity: .5, interactive: false }).addTo(layers.dots);
    }
    // ... and the company itself, highlighted, named, and clickable through to the dashboard's own map.
    let b = null;
    for (const p of here) {
      const at = toLatLng(p.x, p.y);
      b = b ? b.extend(at) : L.latLngBounds(at, at);
      L.circleMarker(at, { renderer: layers.dotRenderer, radius: 9, color: "#ffffff", weight: 3,
        fillColor: CLASS_COLORS[p.class] || "#d9a441", fillOpacity: 1 })
        .bindTooltip(`<div class="tt-name" style="color:${CLASS_COLORS[p.class] || "#fff"}">${esc(p.name)}</div>`
          + `<div class="tt-sub">${esc(describe(p))}</div><div class="tt-zone">${esc(where(p) || "")}</div>`,
          { direction: "top", offset: [0, -8], className: "dot-tip" })
        .on("click", () => { hide(); select(p.guid, true); })
        .addTo(layers.dots);
      L.marker(at, { icon: L.divIcon({ className: "sel-ring", html: "<i></i><i></i>", iconSize: [38, 38] }), interactive: false, keyboard: false }).addTo(layers.dots);
    }

    map.invalidateSize({ pan: false });
    const target = b && b.isValid() ? (b.getNorthEast().equals(b.getSouthWest()) ? (fit || b) : b.pad(0.6)) : fit;
    if (target) map.fitBounds(target, { padding: [28, 28], maxZoom: 1 });
  }

  function drawModal() {
    const g = openKey && find(openKey);
    if (!g) { if (!modal.hidden) closeOne(); return; }
    const { all, before, after } = linesSplit(g);
    const yd = Math.round(spread(g));
    sheetTitle.textContent = names(g);
    sheetSub.textContent = `${plural(g.members.length, "bot")} · together ${ageWords(g.since)} · ${placeOf(g)}`;
    render(sheetTags, `${g.key}|${all.length}|${after.length}|${together(g)}|${yd > SAY_DISTANCE}`, () => [
      factionBadge(factionOf(g.members[0])),
      g.members.map(p => h("span.badge", { title: describe(p) },
        `${p.name} ${p.level} ${CLASSES[p.class] || ""} · ${saidBy(g, p) ? plural(saidBy(g, p), "line") : "silent"}`)),
      !together(g) && h("span.badge.warn", "standing apart"),
      farBadge(g),
      h("span.badge", after.length ? plural(after.length, "line")
        : all.length ? `${all.length} earlier, none here` : "no talk"),
    ]);
    render(modalChat, `${g.key}|${all.length}|${state.chat?.generated}`, () => chatBody(g, before, after));
    toBottom(modalChat);
    drawMap(g);
  }

  function drawWall() {
    const gs = groups();
    const bots = gs.reduce((n, g) => n + g.members.length, 0);
    count.replaceChildren(icon("users", 13), gs.length
      ? `${plural(gs.length, "company", "companies")} · ${plural(bots, "bot")} standing together`
      : "Nobody is grouped right now");
    // The distance badge turns on and off while they stand in the same zone, so the threshold belongs in
    // the signature: placeOf alone would leave it stale.
    const sig = gs.map(g => `${g.key}:${ageKey(g.since)}:${placeOf(g)}:${linesFor(g).length}:${spread(g) > SAY_DISTANCE}`).join("|")
      + `|${state.chat?.generated}`;
    render(grid, sig, () => gs.length ? gs.map(g => card(g, showOne))
      : empty(state.players.length ? "No bots are standing together right now. Companies form a few minutes after a restart."
          : "Waiting for the first snapshot…", "handshake"));
  }

  function draw() {
    if (overlay.hidden) return;
    drawWall();
    if (!modal.hidden) drawModal();
  }

  // ---- Showing and hiding ----

  function showOne(key) {
    openKey = key;
    modal.hidden = false;
    drawModal();
  }

  function closeOne() {
    openKey = null;
    modal.hidden = true;
  }

  function show(opts) {
    const key = opts?.key || null;
    if (overlay.hidden) {
      back = document.activeElement;
      overlay.hidden = false;
      if (app) app.inert = true;
      if (location.hash !== HASH) history.replaceState(null, "", HASH);
      overlay.focus();
      scroll.scrollTop = 0;
    }
    drawWall();
    if (key) showOne(key); else closeOne();
  }

  function hide() {
    if (overlay.hidden) return;
    closeOne();
    overlay.hidden = true;
    if (app) app.inert = false;
    if (location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
    back?.focus?.();
  }

  const hideAll = hide;

  // While open, keys belong here: Esc closes the company first, then the wall.
  window.addEventListener("keydown", e => {
    if (overlay.hidden) return;
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (!modal.hidden) closeOne(); else hideAll();
    }
  }, true);

  const fromHash = () => location.hash === HASH ? show() : hide();
  window.addEventListener("hashchange", fromHash);

  new ResizeObserver(() => { if (!modal.hidden && map) map.invalidateSize({ pan: false }); }).observe(mapEl);

  on("snapshot chat", draw);
  on("theme", draw);
  on("open-groups", show);
  if (location.hash === HASH) fromHash();
}
