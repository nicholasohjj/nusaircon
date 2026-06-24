const axios = require("axios");
const { ORE_HEADERS } = require("./config");
const { escHtml } = require("./utils");

const AXIOS_TIMEOUT_MS = 10_000; // 10 s — prevents hung handlers blocking the chat lock

function toIsoRange(days = 7) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().replace("T", " ").replace("Z", "Z"),
    end: end.toISOString().replace("T", " ").replace("Z", "Z"),
  };
}

async function getMeterInfo(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/cp/get_meter_info",
    {
      request: {
        meter_displayname: meterId,
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) return null;
  return resp.data?.meter_info || null;
}

async function getCreditBalance(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/tcm/get_credit_balance",
    {
      request: {
        meter_displayname: meterId,
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) return null;
  return resp.data?.ref_bal ?? null;
}

async function getMeterSummary(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) {
    return { address: null, credit_bal: null, meter_info: null };
  }

  const [meterInfo, creditBal] = await Promise.allSettled([
    getMeterInfo(meterId),
    getCreditBalance(meterId),
  ]);

  return {
    meter_info: meterInfo.status === "fulfilled" ? meterInfo.value : null,
    address:
      meterInfo.status === "fulfilled"
        ? meterInfo.value?.address || null
        : null,
    credit_bal: creditBal.status === "fulfilled" ? creditBal.value : null,
  };
}

async function getMeterUsage(meterDisplayName, days = 7) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return { days, history: [], meta: null };

  const { start, end } = toIsoRange(days);

  const resp = await axios.post(
    "https://ore.evs.com.sg/get_history",
    {
      request: {
        meter_displayname: meterId,
        history_type: "meter_reading_daily",
        start_datetime: start,
        end_datetime: end,
        normalization: "meter_reading_daily",
        max_number_of_records: "1000",
        convert_to_money: "true",
        check_bypass: "true",
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) {
    throw new Error(`get_history failed with HTTP ${resp.status}`);
  }

  const block = resp.data?.meter_reading_daily || {};
  return {
    days,
    history: Array.isArray(block.history) ? block.history : [],
    meta: block.meta || null,
  };
}

async function getRecentUsageStat(meterDisplayName, lookBackHours = 168) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/cp/get_recent_usage_stat",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/cp/get_recent_usage_stat",
        scope: "self",
        target: "meter.reading",
        operation: "list",
      },
      request: {
        meter_displayname: meterId,
        look_back_hours: lookBackHours,
        convert_to_money: true,
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) return null;
  return resp.data?.usage_stat?.kwh_rank_in_building || null;
}

function extractTopupHistory(data) {
  const candidates = [
    data?.topup_history_3months,
    data?.recent_topups,
    data?.topups,
    data?.topup_history,
    data?.history,
    data?.data,
    data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.history)) return candidate.history;
    if (Array.isArray(candidate?.records)) return candidate.records;
    if (Array.isArray(candidate?.topups)) return candidate.topups;
    if (Array.isArray(candidate?.data)) return candidate.data;
  }

  return [];
}

async function getRecentTopups(
  meterDisplayName,
  { numberOfTopups = 10, lookbackDays = 90 } = {},
) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) {
    return {
      numberOfTopups,
      lookbackDays,
      history: [],
      meta: null,
    };
  }

  const resp = await axios.post(
    "https://ore.evs.com.sg/cp/get_recent_topups",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/cp/get_recent_topups",
        scope: "self",
        target: "evs2user.topup_history_3months",
        operation: "list",
      },
      request: {
        meter_displayname: meterId,
        number_of_topups: numberOfTopups,
        lookback_days: lookbackDays,
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) {
    throw new Error(`get_recent_topups failed with HTTP ${resp.status}`);
  }

  const root = resp.data?.topup_history_3months || resp.data || {};
  return {
    numberOfTopups,
    lookbackDays,
    history: extractTopupHistory(resp.data),
    meta: root.meta || null,
  };
}

async function getMonthToDateUsage(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/get_month_to_date_usage",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/get_month_to_date_usage",
        scope: "self",
        target: "meter.month_to_date_kwh_usage",
        operation: "read",
      },
      request: {
        meter_displayname: meterId,
        convert_to_money: "true",
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
      timeout: AXIOS_TIMEOUT_MS,
    },
  );

  if (resp.status !== 200) return null;
  const val = resp.data?.month_to_date_usage;
  return typeof val === "number" ? val : null;
}

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

function parseOreDate(value) {
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  const sgDateTime = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/,
  );
  if (sgDateTime) {
    return new Date(`${sgDateTime[1]}T${sgDateTime[2]}+08:00`);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSgDateTime(value) {
  const parsed = parseOreDate(value);
  if (!parsed) return escHtml(value);

  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatTopupAmount(record) {
  const amount = pickFirst(record, [
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
  ]);
  const n = toFiniteNumber(amount);
  if (n !== null) return `SGD ${Math.abs(n).toFixed(2)}`;
  return amount == null ? "amount unavailable" : escHtml(amount);
}

function formatTopupHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return "No top-ups found in the last 90 days.";
  }

  return history
    .slice(0, 10)
    .map((record, idx) => {
      const when = pickFirst(record, [
        "topup_datetime",
        "transaction_log_timestamp",
        "transaction_datetime",
        "txn_datetime",
        "payment_datetime",
        "created_at",
        "datetime",
        "date",
        "time",
      ]);
      const ref = pickFirst(record, [
        "transaction_id",
        "transaction_code",
        "txn_id",
        "transaction_ref",
        "txn_ref",
        "reference",
        "ref",
        "receipt_no",
      ]);
      const status = pickFirst(record, ["status", "state", "result"]);

      const parts = [`${idx + 1}. <b>${formatTopupAmount(record)}</b>`];
      if (when) parts.push(`on ${formatSgDateTime(when)}`);
      if (ref) parts.push(`(<code>${escHtml(ref)}</code>)`);
      if (status) parts.push(`- ${escHtml(status)}`);

      return parts.join(" ");
    })
    .join("\n");
}

function analyzeUsage(history = [], creditBal = null) {
  const diffs = history
    .map((x) => Number(x?.reading_diff))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (!diffs.length) {
    return {
      avgDaily: null,
      total: null,
      lastDay: null,
      zeroStreak: 0,
      spike: null,
      warnings: [],
    };
  }

  const total = diffs.reduce((a, b) => a + b, 0);
  const avgDaily = total / diffs.length;
  const lastDay = diffs[0] ?? null; // assuming newest first
  let zeroStreak = 0;

  for (const d of diffs) {
    if (d <= 0.05) zeroStreak += 1;
    else break;
  }

  let spike = null;
  if (
    avgDaily > 0 &&
    lastDay != null &&
    lastDay >= avgDaily * 2.5 &&
    lastDay >= 1
  ) {
    spike = {
      lastDay,
      avgDaily,
      factor: lastDay / avgDaily,
    };
  }

  const warnings = [];

  if (zeroStreak >= 3) {
    warnings.push(`🟡 Usage has been near zero for ${zeroStreak} day(s).`);
  }

  if (spike) {
    warnings.push(
      `🔴 Yesterday's usage (${lastDay.toFixed(2)}) is much higher than your recent average (${avgDaily.toFixed(2)}).`,
    );
  }

  const bal = Number(creditBal);
  if (Number.isFinite(bal) && avgDaily > 0) {
    const daysLeft = bal / avgDaily;
    if (bal < 0) {
      warnings.push("🟠 Current balance is below zero. Top up soon.");
    } else if (daysLeft <= 3) {
      warnings.push(
        `🟠 Current balance may last only about ${daysLeft.toFixed(1)} day(s) at your recent usage.`,
      );
    }
  }

  return {
    avgDaily,
    total,
    lastDay,
    zeroStreak,
    spike,
    warnings,
  };
}

async function formatUsageSummary(
  history = [],
  creditBal = null,
  days = 7,
  meterId = null,
) {
  const a = analyzeUsage(history, creditBal);

  const lines = [];

  if (a.lastDay != null) {
    lines.push(`📈 <b>Yesterday:</b> SGD ${a.lastDay.toFixed(2)}`);
  }
  if (a.avgDaily != null) {
    lines.push(`📊 <b>${days}-day avg:</b> SGD ${a.avgDaily.toFixed(2)} / day`);
  }
  if (a.total != null) {
    lines.push(`🧮 <b>${days}-day total:</b> SGD ${a.total.toFixed(2)}`);
  }

  if (meterId) {
    try {
      const [rankResult, mtdResult] = await Promise.allSettled([
        getRecentUsageStat(meterId),
        getMonthToDateUsage(meterId),
      ]);

      const rank = rankResult.status === "fulfilled" ? rankResult.value : null;
      const mtd = mtdResult.status === "fulfilled" ? mtdResult.value : null;

      if (rank) {
        const pct = (Number(rank.rank_val) * 100).toFixed(0);
        const buildingAvg = Number(rank.ref_val).toFixed(2);
        lines.push(
          `🏆 <b>Building rank:</b> top ${100 - pct}% (building avg: SGD ${buildingAvg}/day)`,
        );
      }

      if (mtd !== null) {
        // negative = spent, so display as positive cost
        lines.push(
          `🗓️ <b>This month so far:</b> SGD ${Math.abs(mtd).toFixed(2)}`,
        );
      }
    } catch {
      // silently skip if rank fetch fails
    }
  }

  if (a.warnings.length) {
    lines.push("");
    lines.push(...a.warnings);
  }

  return lines.join("\n");
}

module.exports = {
  getMeterSummary,
  getMeterUsage,
  getRecentTopups,
  extractTopupHistory,
  analyzeUsage,
  formatUsageSummary,
  formatTopupHistory,
  getMonthToDateUsage,
  getRecentUsageStat,
};
