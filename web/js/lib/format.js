export const CONTINENTS = [["0", "Eastern Kingdoms"], ["1", "Kalimdor"], ["530", "Outland"], ["571", "Northrend"]];
export const CLASSES = { 1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid" };
export const RACES = { 1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead", 6: "Tauren", 7: "Gnome", 8: "Troll", 10: "Blood Elf", 11: "Draenei" };
export const RPG = ["Idle", "Going to grind", "Going to camp", "Wandering", "Visiting NPC", "Questing", "Taking flight", "Resting", "Outdoor PvP"];

// The game's own class colors.
export const CLASS_COLORS = { 1: "#C69B6D", 2: "#F48CBA", 3: "#AAD372", 4: "#FFF468", 5: "#E8E8E8", 6: "#C41E3A", 7: "#0070DD", 8: "#3FC7EB", 9: "#8788EE", 11: "#FF7C0A" };

const date = ts => new Date(ts * 1000);
const isToday = d => d.toDateString() === new Date().toDateString();

export const clock = ts => date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const clockS = ts => date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const full = ts => date(ts).toLocaleString();
// Short stamp: the time today, weekday + time otherwise.
export const stamp = ts => isToday(date(ts)) ? clock(ts) : date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

export const num = n => Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
export const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + num(Math.abs(n));
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const capital = s => s ? s[0].toUpperCase() + s.slice(1) : s;
