const {
  analyzeUsage,
  getMeterSummary,
  getMeterUsage,
  getMonthToDateUsage,
  getRecentTopups,
  getRecentUsageStat,
} = require("./ore");
const {
  getSutdMeterSummary,
  getSutdMeterSummaryAndRecentTopups,
  getSutdRecentTopups,
} = require("./sutdService");

function pickFirst(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .replace(/[^\d.+-]/g, "")
    .trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeUsageRecord(record = {}) {
  return {
    date:
      pickFirst(record, [
        "reading_datetime",
        "datetime",
        "date",
        "timestamp",
        "time",
      ]) || "",
    amount:
      toFiniteNumber(
        pickFirst(record, [
          "reading_diff",
          "usage",
          "usage_amount",
          "amount",
          "value",
        ]),
      ) ?? null,
  };
}

function normalizeTopupRecord(record = {}) {
  return {
    date:
      pickFirst(record, [
        "topup_datetime",
        "transaction_log_timestamp",
        "transaction_datetime",
        "txn_datetime",
        "payment_datetime",
        "created_at",
        "datetime",
        "date",
        "time",
      ]) || "",
    amount:
      toFiniteNumber(
        pickFirst(record, [
          "topup_amount",
          "topup_amt",
          "amount",
          "amount_sgd",
          "txn_amount",
          "transaction_amount",
          "credit_amt",
          "topup_value",
          "value",
          "amt",
        ]),
      ) ?? null,
    reference:
      pickFirst(record, [
        "transaction_id",
        "transaction_code",
        "txn_id",
        "transaction_ref",
        "txn_ref",
        "reference",
        "ref",
        "receipt_no",
      ]) || "",
    status: pickFirst(record, ["status", "state", "result"]) || "",
  };
}

/**
 * Fetches a meter's balance, 7-day usage, or recent top-ups. Callers validate
 * the input and reject SUTD usage lookups, which are not available yet.
 *
 * @param {{ mode: "balance"|"usage"|"topups", meterId: string, hostel?: string }} opts
 */
async function lookupMeter({ mode, meterId, hostel = "" }) {
  const isSutd = hostel === "sutd";
  let topups = null;
  let summary;
  if (isSutd && mode === "topups") {
    const sutdLookup = await getSutdMeterSummaryAndRecentTopups(meterId, {
      numberOfTopups: 10,
    });
    summary = sutdLookup.summary;
    topups = sutdLookup.topups;
  } else {
    summary = isSutd
      ? await getSutdMeterSummary(meterId)
      : await getMeterSummary(meterId);
  }

  const response = {
    ok: true,
    mode,
    meterId,
    hostel: hostel || "",
    address: summary.address || "",
    balance: summary.credit_bal ?? "",
    checkedAt: new Date().toISOString(),
  };

  if (mode === "usage") {
    const [usage, rankResult, monthToDateResult] = await Promise.all([
      getMeterUsage(meterId, 7),
      getRecentUsageStat(meterId).catch(() => null),
      getMonthToDateUsage(meterId).catch(() => null),
    ]);
    response.usage = {
      days: 7,
      history: usage.history.map(normalizeUsageRecord),
      analysis: analyzeUsage(usage.history, summary.credit_bal),
      rank: rankResult,
      monthToDate: monthToDateResult,
    };
  }

  if (mode === "topups") {
    topups =
      topups ||
      (isSutd
        ? await getSutdRecentTopups(meterId, { numberOfTopups: 10 })
        : await getRecentTopups(meterId, {
            numberOfTopups: 10,
            lookbackDays: 90,
          }));
    response.topups = {
      lookbackDays: topups.lookbackDays ?? null,
      source: topups.meta?.source || "ore",
      history: topups.history.slice(0, 10).map(normalizeTopupRecord),
    };
  }

  return response;
}

module.exports = {
  lookupMeter,
  normalizeTopupRecord,
  normalizeUsageRecord,
};
