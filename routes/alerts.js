const { createHash, timingSafeEqual } = require("crypto");
const express = require("express");
const lowBalanceAlerts = require("../bot/services/lowBalanceAlerts");

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

function requireCronSecret(req, res, next) {
  const secret = process.env.LOW_BALANCE_CRON_SECRET?.trim();
  // Stays hidden until it is configured.
  if (!secret) return res.status(404).json({ ok: false, error: "Not found." });

  const supplied = String(req.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!timingSafeEqual(digest(supplied), digest(secret))) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  return next();
}

const router = express.Router();

// Replies straight away because a check can outlast the caller's timeout. The
// outbound requests keep Railway Serverless awake until the check finishes.
router.post("/low-balance-check", requireCronSecret, (req, res) => {
  const started = lowBalanceAlerts.startLowBalanceCheck();
  return res.status(202).json({ ok: true, started });
});

module.exports = { router };
