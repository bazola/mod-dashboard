// Domain helpers: character state, places, companies.
import { state } from "../state.js";
import { CLASSES, RACES, RPG, CONTINENTS } from "./format.js";

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Marker states in legend order. Precedence is decided by stateOf.
export const STATES = [
  ["real", "Players"], ["active", "Active"], ["idle", "Throttled"], ["paused", "Paused"],
  ["combat", "In combat"], ["flight", "Flying"], ["dead", "Dead"],
];
export const STATE_LABEL = Object.fromEntries(STATES);

export function stateOf(p) {
  if (!p.bot) return "real";
  if (p.dead) return "dead";
  if (p.combat) return "combat";
  if (p.paused) return "paused";
  if (p.flight) return "flight";
  return p.active ? "active" : "idle";
}

export const isContinent = map => CONTINENTS.some(([id]) => id === String(map));
export const onContinent = p => !p.instance && String(p.map) === state.continent;
export const onAnyContinent = p => !p.instance && isContinent(p.map);
export const elsewhere = p => p.instance || !isContinent(p.map);
export const where = p => p.instance ? p.map_name : p.zone_name;
export const raceClass = p => `${RACES[p.race] || ""} ${CLASSES[p.class] || ""}`.trim();
export const factionOf = p => p.team === 1 ? "Horde" : "Alliance";

export function activity(p) {
  if (!p.bot) return "Real player";
  if (p.paused) return "Paused";
  return p.active ? (RPG[p.rpg] || "Active") : "Throttled";
}

export const describe = p => `Level ${p.level} ${raceClass(p)}` + (p.bot ? ` · ${activity(p).toLowerCase()}` : " · real player");

export const scoreClass = s => s >= 10 ? "warm" : s <= -10 ? "cold" : "";

export function personName(guid) {
  return state.byGuid.get(guid)?.name || state.regard?.people[String(guid)]?.name || `#${guid}`;
}

// Horde companies in reds and ambers, Alliance companies in blues and violets; stable per guild id.
export function companyColor(gid) {
  const all = state.companies?.companies;
  const c = all?.[String(gid)];
  if (!c) return css("--zone");
  const same = Object.entries(all).filter(([, o]) => o.faction === c.faction).map(([id]) => Number(id)).sort((a, b) => a - b);
  const i = same.indexOf(Number(gid));
  const share = same.length > 1 ? i / (same.length - 1) : 0.5;
  const hue = c.faction === "Horde" ? 350 + share * 55 : 185 + share * 95;
  return `hsl(${hue % 360}, 70%, ${45 + (i % 2) * 10}%)`;
}

export const companyName = gid => state.companies?.companies[String(gid)]?.name || (gid ? `company #${gid}` : "nobody");
