// Display helpers for the metadata-only accounting snapshot.
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nullableNumber = value => value === null || number(value);
const text = value => typeof value === "string";
const timestamp = value => text(value) && Number.isFinite(Date.parse(value));
const measures = ["attempts", "calls", "failures", "pending", "cost", "unknownCostCount", "input", "output", "reasoning", "unattributed"];
const totals = value => object(value) && measures.every(key => number(value[key]));
const groups = (rows, key) => Array.isArray(rows) && rows.every(row => totals(row) && text(row[key]) && row[key].length > 0);

// Validate before publishing to state; rendering must never discard the last
// usable snapshot because a newer file has missing or mistyped fields.
export function isAccountingSnapshot(data) {
  if (!object(data) || data.apiVersion !== 1 || typeof data.available !== "boolean"
      || !number(data.generated) || !timestamp(data.generated_at)
      || data.scope !== "recorded_requests" || data.recentLimit !== 100
      || !totals(data.totals) || !groups(data.purposes, "purpose") || !groups(data.models, "model")
      || !Array.isArray(data.recent) || data.recent.length > data.recentLimit) return false;
  const ids = new Set();
  return data.recent.every(row => {
    if (!object(row) || !text(row.requestId) || !row.requestId || ids.has(row.requestId)
        || !timestamp(row.timestamp) || !text(row.model) || !text(row.purpose) || !text(row.status)
        || !["cost", "input", "output", "reasoning", "seconds"].every(key => nullableNumber(row[key]))
        || !["bot", "botId", "guild", "guildId", "stage"].every(key => row[key] == null || text(row[key]))) return false;
    ids.add(row.requestId);
    return true;
  });
}

export const usd = value => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value)
  : "Unknown";
export const purposeName = value => value && value !== "unknown"
  ? value.replaceAll("_", " ").replace(/^./, x => x.toUpperCase()) : "Unattributed";
export function filterRequests(rows, { query = "", purpose = "", model = "" } = {}) {
  const text = query.trim().toLowerCase();
  return rows.filter(row => (!purpose || row.purpose === purpose) && (!model || row.model === model)
    && (!text || [row.requestId, row.bot, row.guild, row.model, row.purpose, row.stage, row.status]
      .some(value => String(value || "").toLowerCase().includes(text))));
}
