const { Markup } = require("telegraf");

// ── Session stages ────────────────────────────────────────────────────────────
const STAGES = {
  IDLE: "idle",
  AWAITING_HOSTEL: "awaiting_hostel",
  AWAITING_METER_ID: "awaiting_meter_id",
  AWAITING_METER_ID_BALANCE: "awaiting_meter_id_balance",
  AWAITING_METER_ID_USAGE: "awaiting_meter_id_usage",
  AWAITING_METER_ID_TOPUPS: "awaiting_meter_id_topups",
  AWAITING_AMOUNT: "awaiting_amount",
  AWAITING_PAYMENT: "awaiting_payment",
  AWAITING_FEEDBACK_RATING: "awaiting_feedback_rating",
  AWAITING_FEEDBACK_TEXT: "awaiting_feedback_text",
};

// ── Hostels ───────────────────────────────────────────────────────────────────
const HOSTELS = {
  CP2: "cp2",
  CP2NUS: "cp2nus",
  SUTD: "sutd",
};

const HOSTEL_LABELS = {
  [HOSTELS.CP2]:
    "PGPR / Houses @ PGP except Valour House / Residential Colleges / NUS College (cp2)",
  [HOSTELS.CP2NUS]: "UTown Residence / RVRC / Valour House (cp2nus)",
  [HOSTELS.SUTD]: "SUTD",
};

const TOPUP_SUPPORTED_HOSTELS = new Set([
  HOSTELS.CP2,
  HOSTELS.CP2NUS,
  HOSTELS.SUTD,
]);

function normalizeBotAudience(value) {
  const normalized = String(value || "nus")
    .trim()
    .toLowerCase();
  return normalized === "sutd" ? "sutd" : "nus";
}

function createMainKeyboard(audience) {
  return audience === "sutd"
    ? Markup.keyboard([
        ["⚡ Top Up"],
        ["💰 Balance", "🧾 Top-ups"],
        ["ℹ️ Help"],
      ]).resize()
    : Markup.keyboard([
        ["⚡ Top Up"],
        ["💰 Balance", "📊 Usage"],
        ["🧾 Top-ups"],
        ["ℹ️ Help"],
      ]).resize();
}

function createBotConfig(audienceValue = process.env.TELEGRAM_BOT_AUDIENCE) {
  const audience = normalizeBotAudience(audienceValue);
  const allowedHostels =
    audience === "sutd" ? [HOSTELS.SUTD] : [HOSTELS.CP2, HOSTELS.CP2NUS];

  return {
    audience,
    sessionKey: audience,
    displayName: audience === "sutd" ? "SUTD Aircon Bot" : "NUS Aircon Bot",
    supportsTopup: true,
    supportsUsage: audience === "nus",
    allowedHostels,
    defaultLookupHostel: audience === "sutd" ? HOSTELS.SUTD : null,
    mainKeyboard: createMainKeyboard(audience),
  };
}

const DEFAULT_BOT_CONFIG = createBotConfig();
const BOT_AUDIENCE = DEFAULT_BOT_CONFIG.audience;
const BOT_DISPLAY_NAME = DEFAULT_BOT_CONFIG.displayName;
const BOT_SUPPORTS_TOPUP = DEFAULT_BOT_CONFIG.supportsTopup;
const BOT_SUPPORTS_USAGE = DEFAULT_BOT_CONFIG.supportsUsage;
const BOT_ALLOWED_HOSTELS = DEFAULT_BOT_CONFIG.allowedHostels;
const BOT_DEFAULT_LOOKUP_HOSTEL = DEFAULT_BOT_CONFIG.defaultLookupHostel;

// ── TTLs ──────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PENDING_REPLY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Keyboards ─────────────────────────────────────────────────────────────────
const mainKeyboard = DEFAULT_BOT_CONFIG.mainKeyboard;

const cancelKeyboard = Markup.keyboard([["❌ Cancel"]]).resize();

const hostelInlineKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🏠 PGPR / PGP / RC / NUSC (cp2)", "hostel_cp2")],
  [
    Markup.button.callback(
      "🏠 UTown / RVRC / Valour House (cp2nus)",
      "hostel_cp2nus",
    ),
  ],
]);

function ratingKeyboard() {
  return Markup.keyboard([
    ["⭐ 1", "⭐⭐ 2", "⭐⭐⭐ 3", "⭐⭐⭐⭐ 4", "⭐⭐⭐⭐⭐ 5"],
    ["❌ Cancel"],
  ]).resize();
}

const TOPUP_DISABLED_MESSAGE =
  "⚠️ Top-ups are temporarily unavailable.\n\n" +
  "EVS is currently having a vendor-side issue where completed top-ups may not update the meter balance properly.\n\n" +
  "For now, please use the official EVS portal for urgent top-ups, and use /balance here to check your current balance.";

const TOPUP_IN_PROGRESS_STAGES = new Set([
  STAGES.AWAITING_HOSTEL,
  STAGES.AWAITING_METER_ID,
  STAGES.AWAITING_AMOUNT,
  STAGES.AWAITING_PAYMENT,
]);

module.exports = {
  STAGES,
  HOSTELS,
  HOSTEL_LABELS,
  TOPUP_SUPPORTED_HOSTELS,
  normalizeBotAudience,
  createBotConfig,
  DEFAULT_BOT_CONFIG,
  BOT_AUDIENCE,
  BOT_DISPLAY_NAME,
  BOT_SUPPORTS_TOPUP,
  BOT_SUPPORTS_USAGE,
  BOT_ALLOWED_HOSTELS,
  BOT_DEFAULT_LOOKUP_HOSTEL,
  SESSION_TTL_MS,
  PENDING_REPLY_TTL_MS,
  mainKeyboard,
  cancelKeyboard,
  hostelInlineKeyboard,
  ratingKeyboard,
  TOPUP_DISABLED_MESSAGE,
  TOPUP_IN_PROGRESS_STAGES,
};
