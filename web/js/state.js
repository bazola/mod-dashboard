// App state and a tiny publish/subscribe bus. Components read `state` and subscribe to topics:
//   snapshot  /bots arrived               conn       connection status changed
//   regard, lore, companies, chronicle, commands   a data file changed
//   selection, continent, panel, theme, busy, layers   UI state changed
//   focus (player), focus-zone (zone id), mapcounts ({ total, counts, perMap }), focus-search
//   chronicle-faction (the scribe being read), open-chronicle (show the full-screen reader)

export function localGet(key) { try { return localStorage.getItem("dash." + key); } catch { return null; } }
export function localSet(key, value) { try { localStorage.setItem("dash." + key, value); } catch {} }

export const state = {
  // Data from the server
  snap: null,
  players: [],
  byGuid: new Map(),
  worldmap: null,
  mapArt: [],             // maps/manifest.json entries, [] when no art is installed
  regard: null,           // data/regard.json from regard.py
  lore: null,             // data/lore.json from gen_backstories.py
  companies: null,        // data/companies.json from regard.py (plan 14)
  chronicle: null,        // data/chronicle.json from chronicler.py (plan 19)
  market: null,           // data/market.json from market.py (plan 17 §3.E)
  commands: null,         // GET /commands
  history: { bots: [], avg: [] },
  conn: { ok: false, ts: 0, text: "Connecting…" },

  // UI
  theme: localGet("theme") === "light" ? "light" : "dark",
  continent: localGet("continent") || "0",
  panel: localGet("panel") || "roster",
  dockOpen: localGet("dock") !== "0",
  inspectorTab: localGet("itab") || "story",
  chronicleFaction: localGet("chronicle") || "A",
  rosterView: localGet("roster") || "notable",
  query: "",
  token: localGet("token") || "",
  layers: {
    art: localGet("art") !== "0",
    outlines: localGet("outlines") === "1",
    holdings: localGet("holdings") !== "0",
  },
  hidden: new Set(),      // marker states hidden from the map via the legend
  selected: null,         // character guid
  selectedCompany: null,  // guild id, shown when no character is selected
  lastResult: null,       // { guid, ok, text } of the last command
  busy: false,
};

const subs = new Map();

export function on(topics, fn) {
  for (const t of topics.split(/\s+/).filter(Boolean)) {
    if (!subs.has(t)) subs.set(t, new Set());
    subs.get(t).add(fn);
  }
}

export function emit(topic, payload) {
  for (const fn of subs.get(topic) || []) {
    try { fn(payload); } catch (e) { console.error(`[dashboard] ${topic} handler failed`, e); }
  }
}
