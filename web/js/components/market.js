// Market panel (market.py, plan 17 §3.E): the auction houses, what sells, and the prices the market has learned.
import { state, on } from "../state.js";
import { h, icon, render } from "../lib/dom.js";
import { clock, full, num, plural } from "../lib/format.js";
import { section, time, empty, kpis } from "./common.js";

const STALE_S = 30 * 60;   // market.py writes every 10 minutes
const KIND_WORDS = { merchant: "merchant", bot: "townsfolk", player: "player" };
const KINDS = ["merchant", "bot", "player"];

// market.json stamps are local ISO times ("2026-09-15T21:40:00"); the format helpers take epoch seconds.
const secs = iso => Math.floor(Date.parse(iso) / 1000);

// 123456 → 12g 34s 56c, with the zero units in front left out.
export function money(copper) {
  const c = Math.max(0, Math.round(copper || 0));
  const parts = [[Math.floor(c / 10000), "g"], [Math.floor(c / 100) % 100, "s"], [c % 100, "c"]];
  const first = parts.findIndex(([v]) => v > 0);
  const shown = first < 0 ? [[0, "c"]] : parts.slice(first).filter(([v], i) => v > 0 || i === 0);
  return h("span.money", { title: `${c.toLocaleString()} copper` }, shown.map(([v, u]) => h(`span.coin.${u}`, `${v}${u}`)));
}

const goodName = g => h("span.good", { class: `q${Math.min(Math.max(g.quality ?? 1, 0), 5)}`, title: `item ${g.entry}` }, g.name);

function houses(list) {
  const max = Math.max(1, ...list.map(x => x.listings));
  return [
    h("div.houses", list.map(x => h("div.house",
      h("div.house-head", h("b", x.name), h("span.house-n", num(x.listings))),
      h("div.stack", { title: KINDS.map(k => `${KIND_WORDS[k]} ${num(x[k] || 0)}`).join(" · ") },
        KINDS.map(k => (x[k] || 0) > 0 && h(`span.seg-${k}`, { style: { width: `${(x[k] / max) * 100}%` } })))))),
    h("div.mlegend", KINDS.map(k => h("span", h(`i.dot-${k}`), KIND_WORDS[k]))),
  ];
}

// 24 columns: sales as bars, listed and expired as lines on their own scale. Numbers only go into the markup.
function hoursChart(hours) {
  const w = 300, ht = 84, pad = 4, n = hours.length;
  const col = (w - pad * 2) / n;
  const maxSales = Math.max(1, ...hours.map(x => x.sales));
  const maxFlow = Math.max(1, ...hours.map(x => Math.max(x.listed, x.expired)));
  const label = x => new Date(Date.parse(x.hour)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const bars = hours.map((x, i) => {
    const bh = x.sales ? Math.max(2, (x.sales / maxSales) * (ht - 14)) : 0;
    const tip = `${label(x)}: ${x.sales} sold, ${Math.round(x.copper / 100) / 100}g · ${x.listed} listed, ${x.expired} expired`;
    return `<g><title>${tip}</title><rect class="hit" x="${(pad + i * col).toFixed(1)}" y="0" width="${col.toFixed(1)}" height="${ht}"/>`
      + (bh ? `<rect class="bar" x="${(pad + i * col + 1).toFixed(1)}" y="${(ht - bh).toFixed(1)}" width="${Math.max(1, col - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>` : "")
      + "</g>";
  }).join("");
  const line = key => hours.map((x, i) =>
    `${i ? "L" : "M"}${(pad + (i + 0.5) * col).toFixed(1)},${(ht - 2 - (x[key] / maxFlow) * (ht - 14)).toFixed(1)}`).join("");
  const svg = `<svg class="mchart" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="Sales, listings and expiries per hour">`
    + bars + `<path class="ln listed" d="${line("listed")}"/><path class="ln expired" d="${line("expired")}"/></svg>`;
  const first = hours[0], last = hours[n - 1];
  return [
    h("div.mchart-wrap", { html: svg }),
    h("div.mchart-axis", h("span", label(first)), h("span", label(last))),
    h("div.mlegend", h("span", h("i.dot-sales"), "sold"), h("span", h("i.dot-listed"), "listed"), h("span", h("i.dot-expired"), "expired")),
  ];
}

function goodRow(g) {
  const learned = g.market_copper;
  const drift = learned != null && g.unit_copper ? learned / g.unit_copper - 1 : 0;
  return h("div.good-row",
    h("div.good-main", goodName(g), h("span.row-sub", `${plural(g.sales, "sale")} · ${plural(g.listings, "listing")}`)),
    h("div.good-price",
      money(g.unit_copper),
      learned != null
        ? h("span.learned", { class: drift > 0.02 ? "up" : drift < -0.02 ? "down" : "", title: "Price the market has learned from sales" },
            icon(drift < -0.02 ? "down" : "up", 11), money(learned))
        : h("span.learned.none", "no learned price")));
}

function sale(s) {
  return h("div.tl", { title: full(secs(s.ts)) },
    h("span.tl-icon", { class: s.buyer_kind === "player" || s.seller_kind === "player" ? "warm" : "" }, icon("coins", 14)),
    h("div.tl-line", goodName(s), s.count > 1 && h("span.muted", ` ×${s.count}`)),
    time(secs(s.ts)),
    h("div.tl-text",
      `${s.seller || "someone"} (${KIND_WORDS[s.seller_kind] || s.seller_kind}) to a ${KIND_WORDS[s.buyer_kind] || s.buyer_kind} · `,
      money(s.copper),
      state.market?.houses?.find(x => x.id === s.house) ? ` · ${state.market.houses.find(x => x.id === s.house).name}` : ""));
}

export function mountMarket(panel) {
  const meta = h("div.meta", icon("coins", 13), "Waiting for market data…");
  const stats = h("div");
  const house = section("Auction houses", { icon: "coins", key: "m.houses" });
  const day = section("Last day", { icon: "activity", key: "m.day" });
  const goods = section("Most traded goods", { icon: "sparkle", key: "m.goods" });
  const recent = section("Recent sales", { icon: "handshake", key: "m.recent" });
  const blocks = [stats, house.el, day.el, goods.el, recent.el];
  const none = h("div");
  panel.append(meta, none, ...blocks);

  function draw() {
    const m = state.market;
    const ok = m && Array.isArray(m.houses);
    render(none, ok ? "data" : "none", () => !ok && empty("No market data yet. It appears once the merchants open their stalls.", "coins"));
    for (const b of blocks) b.hidden = !ok;
    if (!ok) return;

    const gen = secs(m.generated_at);
    const stale = Date.now() / 1000 - gen > STALE_S;
    meta.replaceChildren(icon("coins", 13), `Updated ${clock(gen)}`,
      stale ? h("span.badge.warn", { title: `Last written ${full(gen)}` }, "stale") : "");

    const hours = m.hours || [];
    const sold = hours.reduce((a, x) => a + x.sales, 0);
    const copper = hours.reduce((a, x) => a + x.copper, 0);
    const listings = m.houses.reduce((a, x) => a + x.listings, 0);
    render(stats, `${m.generated_at}`, () => kpis([
      ["listings", num(listings)],
      ["sold today", num(sold), sold ? "warm" : ""],
      ["gold today", num(Math.floor(copper / 10000))],
      [m.prices?.moved ? `prices learned · ${num(m.prices.moved)} moved` : "prices learned", num(m.prices?.tracked ?? 0)],
    ]));

    house.count(m.houses.length);
    render(house.body, `${m.generated_at}`, () => m.houses.length ? houses(m.houses) : empty("No auction house is open.", "coins"));

    day.count(sold || null);
    render(day.body, `${m.generated_at}`, () => hours.length >= 2 ? hoursChart(hours) : empty("Not enough hours recorded yet.", "activity"));

    const top = m.top_goods || [];
    goods.count(top.length);
    render(goods.body, `${m.generated_at}`, () => top.length ? h("div.list", top.map(goodRow)) : empty("Nothing has changed hands yet.", "sparkle"));

    const rs = m.recent || [];
    recent.count(rs.length);
    render(recent.body, `${m.generated_at}`, () => rs.length ? rs.map(sale) : empty("No sales yet.", "handshake"));
  }

  on("market", draw);
  draw();
  // Keep the stale badge honest between file changes.
  setInterval(() => { if (state.market) draw(); }, 60000);
}
