// Costs use the same exported-data and full-page pattern as the other dashboard panels.
import { state, on } from "../state.js";
import { h, icon } from "../lib/dom.js";
import { num } from "../lib/format.js";
import { kpis, empty, section } from "./common.js";
import { refreshAccounting } from "../api.js";
import { usd, purposeName, filterRequests } from "../lib/accounting.js";

const HASH = "#costs";
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unknown";

function freshness() {
  const data = state.accounting;
  if (!data) return state.accountingError || "Loading accounting data...";
  const stale = Date.now() / 1000 - data.generated > 180;
  return `Updated ${date(data.generated_at)}${stale ? " - stale snapshot" : ""}${state.accountingError ? " - refresh failed" : ""}`;
}

function metrics(data) {
  const t = data.totals;
  return kpis([["Known charges (USD)", usd(t.cost)], ["Recorded requests", num(t.attempts)],
    ["Unknown charges", num(t.unknownCostCount)], ["Pending", num(t.pending)],
    ["Failed", num(t.failures)], ["Unattributed", num(t.unattributed)]]);
}

function breakdown(rows, field) {
  if (!rows.length) return empty("No requests recorded.", "coins");
  return h("div.cost-breakdown", rows.map(row => h("div.cost-group",
    h("div", h("b", field === "purpose" ? purposeName(row[field]) : row[field]),
      h("div.row-sub", `${num(row.attempts)} requests / ${num(row.input)} input / ${num(row.output)} output tokens`,
        row.unknownCostCount ? ` / ${num(row.unknownCostCount)} unknown charges` : "")),
    h("strong", usd(row.cost)))));
}

export function mountAccounting(panel, root) {
  let back = null;
  let page = 0;
  const renderedRows = new Map();
  const PAGE_SIZE = 25;
  const panelMeta = h("div.meta");
  const panelContent = h("div");
  const open = h("button.btn", { type: "button", on: { click: show } }, icon("expand", 15), "Open costs page");
  panel.append(panelMeta, panelContent, open);

  const meta = h("div.meta", { role: "status" });
  const stats = h("div");
  const notice = h("p.cost-note");
  const tokenTotals = h("p.cost-note");
  const purposes = section("By purpose", { icon: "scroll", key: "cost.purposes" });
  const models = section("By model", { icon: "activity", key: "cost.models" });
  const search = h("input.input", { type: "search", placeholder: "Search recent requests", "aria-label": "Search recent requests",
    on: { input: () => { page = 0; drawRequests(); } } });
  const purpose = h("select.input", { "aria-label": "Filter recent requests by purpose", on: { change: () => { page = 0; drawRequests(); } } });
  const model = h("select.input", { "aria-label": "Filter recent requests by model", on: { change: () => { page = 0; drawRequests(); } } });
  const requestMeta = h("p.cost-note", { role: "status", tabindex: "-1" });
  const requestList = h("div.cost-requests");
  const previous = h("button.btn", { type: "button", on: { click: () => { page--; drawRequests(); } } }, "Previous");
  const next = h("button.btn", { type: "button", on: { click: () => { page++; drawRequests(); } } }, "Next");
  const pager = h("div.cost-pager", previous, next);
  const content = h("div.cost-content", stats, notice, tokenTotals,
    h("div.cost-columns", purposes.el, models.el),
    h("section", h("h2", "Recent requests"),
      h("p.cost-note", "Filters apply to the latest 100 requests. Totals and breakdowns cover all recorded requests."),
      h("div.cost-filters", search, purpose, model), requestMeta, requestList, pager));
  const unavailable = h("div");
  const close = h("button.icon-btn", { type: "button", title: "Close costs (Esc)", "aria-label": "Close costs", on: { click: hide } }, icon("x", 18));
  const refresh = h("button.btn", { type: "button", on: { click: () => refreshAccounting() } }, icon("activity", 15), "Refresh");
  const overlay = h("div.fx-overlay.cost-page", { hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "Model costs", tabindex: "-1" },
    h("div.fx-bar", h("h1.cost-title", icon("coins", 18), "Model costs"), meta, h("div.fx-bar-end", refresh, close)),
    h("div.fx-scroll", unavailable, content));
  root.append(overlay);

  function options(select, rows, key, title) {
    const signature = JSON.stringify(rows.map(row => row[key]));
    if (select.dataset.options === signature) return;
    select.dataset.options = signature;
    const previous = select.value;
    select.replaceChildren(h("option", { value: "" }, title), ...rows.map(row =>
      h("option", { value: row[key] }, key === "purpose" ? purposeName(row[key]) : row[key])));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  function drawRequests() {
    const rows = filterRequests(state.accounting?.recent || [], { query: search.value, purpose: purpose.value, model: model.value });
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / PAGE_SIZE) - 1));
    const start = page * PAGE_SIZE;
    requestMeta.textContent = rows.length ? `${start + 1}-${Math.min(start + PAGE_SIZE, rows.length)} of ${rows.length} matching recent requests` : "No matching recent requests.";
    previous.disabled = page === 0;
    next.disabled = start + PAGE_SIZE >= rows.length;
    const focused = requestList.contains(document.activeElement) ? document.activeElement : null;
    const nodes = rows.slice(start, start + PAGE_SIZE).map(row => {
      const guid = row.botId || (/^\d+$/.test(row.bot || "") ? row.bot : null);
      const actor = (guid && state.byGuid.get(Number(guid))?.name)
        || (row.bot && !/^\d+$/.test(row.bot) ? row.bot : null)
        || row.guild || (guid ? `Character #${guid}` : row.guildId ? `Guild #${row.guildId}` : "No actor recorded");
      const signature = JSON.stringify([row, actor]);
      const existing = renderedRows.get(row.requestId);
      if (existing?.signature === signature) return existing.node;
      const node = h("details.cost-request", { dataset: { requestId: row.requestId } }, h("summary", h("div", h("b", purposeName(row.purpose)), h("div.row-sub", `${actor} / ${row.model || "Unknown model"}`)),
        h("div.cost-request-end", h("strong", usd(row.cost)), h("span.row-sub", row.status))),
        h("dl.cost-detail", ...[
          ["Time", date(row.timestamp)], ["Stage", row.stage || "Not recorded"], ["Request ID", row.requestId],
          ["Input / output tokens", `${num(row.input || 0)} / ${num(row.output || 0)}`], ["Reasoning tokens", num(row.reasoning || 0)],
          ["Duration", row.seconds == null ? "Unknown" : `${Number(row.seconds).toFixed(2)} s`],
        ].flatMap(([key, value]) => [h("dt", key), h("dd", value)])));
      if (existing) {
        // Keep the details and summary elements: open state and keyboard focus belong to them.
        existing.node.querySelector("summary").replaceChildren(...node.querySelector("summary").childNodes);
        existing.node.querySelector("dl").replaceChildren(...node.querySelector("dl").childNodes);
        existing.signature = signature;
        return existing.node;
      }
      renderedRows.set(row.requestId, { node, signature });
      return node;
    });
    const current = [...requestList.children];
    if (nodes.length !== current.length || nodes.some((node, i) => node !== current[i])) {
      requestList.replaceChildren(...nodes);
      if (focused?.isConnected) focused.focus({ preventScroll: true });
      else if (focused) requestMeta.focus({ preventScroll: true });
    }
    const retained = new Set((state.accounting?.recent || []).map(row => row.requestId));
    for (const id of renderedRows.keys()) if (!retained.has(id)) renderedRows.delete(id);
  }

  function draw() {
    panelMeta.textContent = meta.textContent = freshness();
    const data = state.accounting;
    const ready = data?.available === true;
    content.hidden = !ready;
    const explanation = state.accountingError || "Accounting is not available. Configure the accounting exporter to publish this realm's request ledger.";
    panelContent.replaceChildren(ready ? metrics(data) : empty(explanation, "coins"));
    unavailable.replaceChildren(...(ready ? [] : [empty(explanation, "coins")]));
    if (!ready) return;
    stats.replaceChildren(metrics(data));
    notice.textContent = "Known charges include billed failures. Missing billing is unknown, not free. These totals cover this ledger, not your entire provider account.";
    tokenTotals.textContent = `${num(data.totals.input)} input tokens / ${num(data.totals.output)} output tokens / ${num(data.totals.reasoning)} reasoning tokens (included in output when reported by the provider).`;
    purposes.body.replaceChildren(breakdown(data.purposes, "purpose"));
    models.body.replaceChildren(breakdown(data.models, "model"));
    options(purpose, data.purposes, "purpose", "All purposes");
    options(model, data.models, "model", "All models");
    drawRequests();
  }

  function show() {
    if (!overlay.hidden) return;
    back = document.activeElement;
    overlay.hidden = false;
    document.getElementById("app").inert = true;
    if (location.hash !== HASH) history.replaceState(null, "", HASH);
    overlay.focus();
    refreshAccounting();
    draw();
  }
  function hide() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.getElementById("app").inert = false;
    if (location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
    back?.focus?.();
  }
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hide(); }
    if (event.key === "Tab") {
      const targets = [...overlay.querySelectorAll('button:not(:disabled), input, select, summary')].filter(el => el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener("hashchange", () => location.hash === HASH ? show() : hide());
  on("accounting", draw);
  setInterval(() => { panelMeta.textContent = meta.textContent = freshness(); }, 30000);
  draw();
  if (location.hash === HASH) show();
}
