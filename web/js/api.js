// Server polling. Each loop reschedules itself after it finishes, so slow responses never pile up.
import { state, emit } from "./state.js";

const REFRESH_MS = 2000;
const DATA_MS = 30000;
const LORE_MS = 300000;
const MARKET_MS = 60000;   // market.py rewrites its file every 10 minutes
const HISTORY = 90;   // samples kept for the top-bar sparklines (3 minutes at 2 s)

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 503 ? "snapshot not ready" : `HTTP ${res.status}`);
  return res.json();
}

function loop(fn, ms) {
  const tick = async () => {
    try { await fn(); } catch {} finally { setTimeout(tick, ms); }
  };
  tick();
}

const push = (arr, v) => { arr.push(v); if (arr.length > HISTORY) arr.shift(); };

export async function loadStatic() {
  try {
    state.worldmap = await getJSON("worldmap");
  } catch (e) {
    state.conn = { ok: false, ts: 0, text: `could not load zone data (${e.message})` };
    emit("conn");
  }
  try { state.mapArt = await getJSON("maps/manifest.json"); } catch { state.mapArt = []; }
}

export async function refreshCommands() {
  try {
    state.commands = await getJSON("commands");
    emit("commands");
  } catch {}
}

// A person's whole standing lives in a file of its own, fetched when their Ties tab is opened:
// a well-travelled bot has upwards of 150 ties, far too many to carry in regard.json. The cache
// entry is stamped with the regard.json it was fetched beside, so a new cycle refetches it; the
// ties already on screen stay there while it does, and `at` tells the inspector to redraw.
export function loadTies(guid) {
  const stamp = state.regard?.generated;
  const held = state.ties.get(guid);
  if (held && held.stamp === stamp) return;
  state.ties.set(guid, { stamp, doc: held?.doc || null, at: held?.at || 0 });
  const land = doc => { state.ties.set(guid, { stamp, doc, at: Date.now() }); emit("ties", guid); };
  getJSON(`data/ties/${guid}.json`).then(land, () => land(held?.doc || { feels: [], felt_by: [] }));
}

// The whole of one of the Feelings panel's lists -- every moment, every conversation overheard, every
// tie ranked warmest to coldest. Megabytes each, so they are fetched only when a full-screen view asks
// for one, and re-fetched when regard.py has written a newer set.
export function loadArchive(name, force = false) {
  const stamp = state.regard?.generated;
  const held = state.archive.get(name);
  if (held && held.stamp === stamp && !force) return;
  state.archive.set(name, { stamp, doc: held?.doc || null, at: held?.at || 0, failed: false });
  const land = (doc, failed) => { state.archive.set(name, { stamp, doc, at: Date.now(), failed }); emit("archive", name); };
  getJSON(`data/${name}.json`).then(doc => land(doc, false), () => land(held?.doc || null, true));
}

export function startPolling() {
  loop(async () => {
    try {
      const snap = await getJSON("bots");
      state.snap = snap;
      state.players = snap.players;
      state.byGuid = new Map(snap.players.map(p => [p.guid, p]));
      push(state.history.bots, snap.counts.bots);
      push(state.history.avg, snap.update_ms.avg);
      state.conn = { ok: true, ts: snap.ts, text: "" };
      emit("snapshot");
      if (state.panel === "commands" && state.dockOpen) refreshCommands();
    } catch (e) {
      state.conn = { ok: false, ts: state.conn.ts, text: e.message };
    }
    emit("conn");
  }, REFRESH_MS);

  // Data files are rewritten by the Python services; redraw only when a new one was generated.
  const stampOf = doc => doc.generated ?? doc.generated_at;
  const watch = (url, key, ms) => loop(async () => {
    const next = await getJSON(url);
    if (!state[key] || stampOf(next) === undefined || stampOf(next) !== stampOf(state[key])) {
      state[key] = next;
      emit(key);
    }
  }, ms);
  watch("data/regard.json", "regard", DATA_MS);
  watch("data/companies.json", "companies", DATA_MS);
  watch("data/chronicle.json", "chronicle", DATA_MS);
  watch("data/lore.json", "lore", LORE_MS);
  watch("data/lore-edit.json", "loreEdit", DATA_MS);
  watch("data/market.json", "market", MARKET_MS);
  watch("data/chat.json", "chat", DATA_MS);
}
