const {
  STAGES,
  HOSTELS,
  HOSTEL_LABELS,
  DEFAULT_BOT_CONFIG,
  TOPUP_SUPPORTED_HOSTELS,
  cancelKeyboard,
  hostelInlineKeyboard,
} = require("../constants");
const { getSession, resetSession } = require("./session");
const { getSavedMeters, getUser } = require("./userStore");
const {
  savedMeterPickerKeyboard,
  savedMeterPickerText,
} = require("./savedMeterPicker");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

function getHostelLabel(hostel) {
  return HOSTEL_LABELS[hostel] ?? HOSTEL_LABELS[HOSTELS.CP2];
}

function getWebAppPath(hostel) {
  if (!TOPUP_SUPPORTED_HOSTELS.has(hostel)) return null;
  if (hostel === HOSTELS.SUTD) return "/sutd/webapp";
  return hostel === HOSTELS.CP2NUS ? "/cp2nus/webapp" : "/webapp";
}

function getAmountPrompt(hostel) {
  return hostel === HOSTELS.SUTD ? "min $10, max $50" : "min $6, max $50";
}

function isHttpsUrl(url) {
  try {
    return new URL(String(url)).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Initialises a top-up session, reusing any saved meter ID / hostel.
 * Returns the session (already mutated) so the caller can inspect the stage.
 *
 * savedInSession — meter ID from a deep-link that was stashed before reset.
 */
function startTopUp(
  chatId,
  savedInSession = null,
  config = DEFAULT_BOT_CONFIG,
) {
  resetSession(chatId, config.sessionKey);
  const session = getSession(chatId, config.sessionKey);

  const dbUser = getUser(chatId);
  const dbUserAllowed =
    dbUser && config.allowedHostels.includes(dbUser.hostel) ? dbUser : null;
  const meterId = savedInSession ?? dbUserAllowed?.meterId ?? null;
  const hostel =
    config.audience === "sutd"
      ? HOSTELS.SUTD
      : dbUserAllowed?.hostel || null;

  if (meterId) session.txtMtrId = meterId;
  if (hostel) session.hostel = hostel;

  session.stage =
    session.txtMtrId && session.hostel
      ? STAGES.AWAITING_AMOUNT
      : config.audience === "sutd"
        ? STAGES.AWAITING_METER_ID
        : STAGES.AWAITING_HOSTEL;

  return session;
}

/**
 * Sends the appropriate first message for a top-up flow.
 * Handles three cases:
 *   1. Both meter ID and hostel saved → jump straight to amount
 *   2. Only meter ID saved → ask hostel
 *   3. Nothing saved → ask hostel
 */
async function handleTopUpStart(
  ctx,
  chatId,
  savedInSession = null,
  config = DEFAULT_BOT_CONFIG,
) {
  const savedMeters = savedInSession
    ? []
    : getSavedMeters(chatId).filter((meter) =>
        config.allowedHostels.includes(meter.hostel),
      );
  if (savedMeters.length > 1) {
    resetSession(chatId, config.sessionKey);
    return ctx.reply(
      savedMeterPickerText("topup"),
      savedMeterPickerKeyboard("topup", savedMeters),
    );
  }

  const session = startTopUp(chatId, savedInSession, config);

  if (session.stage === STAGES.AWAITING_AMOUNT) {
    return ctx.reply(
      `🔌 Using saved Meter ID: <code>${session.txtMtrId}</code>\n` +
        `🏠 Hostel: <b>${getHostelLabel(session.hostel)}</b>\n\n` +
        `Enter the amount in SGD (${getAmountPrompt(session.hostel)}), or tap ❌ Cancel to start over.\n\n` +
        `💡 Use /forget to clear your saved details.`,
      { parse_mode: "HTML", ...cancelKeyboard },
    );
  }

  if (config.audience === "sutd") {
    return ctx.reply("🔌 Please enter your 8-digit SUTD Meter ID:", {
      ...cancelKeyboard,
      reply_markup: {
        ...cancelKeyboard.reply_markup,
        input_field_placeholder: "e.g. 20000596",
      },
    });
  }

  if (session.txtMtrId) {
    return ctx.reply(
      `🔌 Using saved Meter ID: <code>${session.txtMtrId}</code>\n\n` +
        `🏠 Please select your hostel:`,
      { parse_mode: "HTML", reply_markup: hostelInlineKeyboard.reply_markup },
    );
  }

  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard);
}

module.exports = {
  SERVER_URL,
  getHostelLabel,
  getWebAppPath,
  getAmountPrompt,
  isHttpsUrl,
  startTopUp,
  handleTopUpStart,
};
