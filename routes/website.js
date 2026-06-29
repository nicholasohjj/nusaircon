const express = require("express");
const { escHtml } = require("../services/utils");
const {
  analyzeUsage,
  getMeterSummary,
  getMeterUsage,
  getMonthToDateUsage,
  getRecentTopups,
  getRecentUsageStat,
} = require("../services/ore");
const {
  getSutdMeterSummary,
  getSutdMeterSummaryAndRecentTopups,
  getSutdRecentTopups,
} = require("../services/sutdService");
const { track, captureException } = require("../services/analytics");
const { isValidMeterId } = require("../services/validators");
const { createJsonRateLimiter } = require("../services/httpMiddleware");
const { getWebsiteTopupStatus } = require("../services/topupAvailability");
const { getPaymentBot } = require("../bot/bot");

const router = express.Router();
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

router.use(express.json({ limit: "16kb" }));

const lookupLimiter = createJsonRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: "Too many meter lookups. Please wait a few minutes and try again.",
});

const feedbackLimiter = createJsonRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  message: "Too many feedback submissions. Please wait before trying again.",
});

const LOOKUP_HOSTELS = new Set(["cp2", "cp2nus", "sutd"]);

router.get("/topup-status", (req, res) => {
  return res.json({
    ok: true,
    topup: getWebsiteTopupStatus(),
  });
});

function normalizeLookupHostel(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase();
  if (!clean) return "";
  return LOOKUP_HOSTELS.has(clean) ? clean : null;
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

router.get("/lookup", lookupLimiter, async (req, res) => {
  const mode = String(req.query.mode || "balance").toLowerCase();
  const meterId = String(req.query.meterId || "").trim();
  const hostel = normalizeLookupHostel(req.query.hostel);

  if (!["balance", "usage", "topups"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "Invalid lookup mode." });
  }

  if (hostel === null) {
    return res.status(400).json({ ok: false, error: "Invalid hostel." });
  }

  if (!isValidMeterId(meterId)) {
    return res.status(400).json({
      ok: false,
      error: "Meter ID must be exactly 8 digits.",
    });
  }

  try {
    const isSutd = hostel === "sutd";
    if (isSutd && mode === "usage") {
      return res.status(400).json({
        ok: false,
        error: "Usage history is not available for SUTD yet.",
      });
    }

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

    track("website_lookup", { meterId, mode, hostel: hostel || "auto" });
    return res.json(response);
  } catch (err) {
    captureException(err, meterId || "anonymous", {
      route: "website",
      endpoint: "/website/lookup",
      mode,
      hostel: hostel || "auto",
    });
    return res.status(502).json({
      ok: false,
      error: "Unable to fetch meter details. Please try again.",
    });
  }
});

router.post("/feedback", feedbackLimiter, async (req, res) => {
  const rating = Number(req.body?.rating);
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  const contact = String(req.body?.contact || "").trim().slice(0, 160);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({
      ok: false,
      error: "Please choose a rating from 1 to 5.",
    });
  }

  track("website_feedback_submitted", {
    rating,
    hasMessage: Boolean(message),
    hasContact: Boolean(contact),
  });

  console.log(
    `Website feedback: rating=${rating}`,
    message ? `message="${message}"` : "(no message)",
    contact ? `contact="${contact}"` : "",
  );

  if (OWNER_CHAT_ID) {
    const lines = [
      "Website feedback",
      `Rating: ${rating}/5`,
      contact ? `Contact: <code>${escHtml(contact)}</code>` : "",
      message ? `Message: <i>${escHtml(message)}</i>` : "",
    ].filter(Boolean);

    await getPaymentBot("nus")
      .telegram
      .sendMessage(OWNER_CHAT_ID, lines.join("\n"), { parse_mode: "HTML" })
      .catch((err) => {
        console.error("Failed to notify owner about website feedback:", err);
      });
  }

  return res.json({ ok: true });
});

module.exports = {
  normalizeTopupRecord,
  normalizeUsageRecord,
  router,
};
