// The companies of bots standing together right now, and the words they have exchanged.
//
// A company leaves no trace that can be read back. The core does persist `groups`/`group_member`, but
// the dashboard issues no SQL by design, and ledger_chat carries no group id at all -- listener_guid is
// NULL for every bot-to-bot party line, because mod-ledger only fills it from NearestRealPlayer. What
// /bots does carry is group_leader per player, live to the 2 s snapshot. So membership comes from there
// and the talk comes from data/chat.json, matched up by speaker.
import { state, localGet, localSet } from "../state.js";
import { where } from "./world.js";

// A company is keyed by its members, not its leader: leadership passes between bots while they stand
// together, and LeaveGroupAction hands it over on a level gap or a map change.
export const keyOf = members => members.map(p => p.guid).sort((a, b) => a - b).join("-");

export function groupsNow() {
  const by = new Map();
  for (const p of state.players) {
    const leader = p.group_leader || 0;
    if (!leader) continue;
    if (!by.has(leader)) by.set(leader, []);
    by.get(leader).push(p);
  }
  const out = [];
  for (const [leader, members] of by) {
    // One member is a company half formed or half broken; it is not yet anybody's company.
    if (members.length < 2) continue;
    members.sort((a, b) => (b.guid === leader) - (a.guid === leader) || a.name.localeCompare(b.name));
    out.push({ leader, key: keyOf(members), members, since: Date.now() });
  }
  return out.sort((a, b) => a.members[0].name.localeCompare(b.members[0].name));
}

// ---- How long they have stood together ----
//
// /bots has no join time, and ledger_event has a group_join row for fewer than half the bots standing in
// a company right now, so neither can answer this. What the dashboard can say honestly is how long it
// has watched them, kept across reloads in localStorage and pruned once a company is long gone.
const SEEN_KEY = "groups.seen";
const KEEP_MS = 36 * 3600 * 1000;

let seen = (() => {
  try { return JSON.parse(localGet(SEEN_KEY) || "{}") || {}; } catch { return {}; }
})();

export function markSeen(groups) {
  const now = Date.now();
  let changed = false;
  for (const g of groups) {
    const rec = seen[g.key];
    if (!rec) { seen[g.key] = { first: now, last: now }; changed = true; }
    else if (now - rec.last > 30000) { rec.last = now; changed = true; }
    g.since = seen[g.key].first;
  }
  for (const [k, rec] of Object.entries(seen)) {
    if (now - rec.last > KEEP_MS) { delete seen[k]; changed = true; }
  }
  if (changed) localSet(SEEN_KEY, JSON.stringify(seen));
  return groups;
}

export function ageWords(since) {
  const mins = Math.max(0, Math.round((Date.now() - since) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Bucketed to the minute so a render signature does not change on every 2 s poll.
export const ageKey = since => Math.floor((Date.now() - since) / 60000);

// ---- What they said ----
//
// chat.json is the whole party record, so lines these bots said in an earlier company are here too. That
// is their whole chat history, which is what was asked for; the panel marks where this company begins.
export function linesFor(g) {
  const guids = new Set(g.members.map(p => p.guid));
  return (state.chat?.lines || []).filter(l => guids.has(l.guid));
}

// Where the company is. A pair strung out behind its leader can be two zones or two continents apart,
// which is worth seeing rather than hiding behind the leader's zone.
export function placeOf(g) {
  const names = [...new Set(g.members.map(p => where(p) || "somewhere"))];
  return names.join(" · ");
}

export const together = g => new Set(g.members.map(p => where(p) || "")).size === 1;
