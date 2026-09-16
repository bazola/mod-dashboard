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
}
