const { track } = require("../../services/analytics");
const { forgetUser } = require("../services/userStore");
const { isValidMeterId } = require("../../services/validators");
const { resetSession, getSession } = require("../services/session");
const { handleMeterLookupStart } = require("../services/lookup");
const {
  getAmountPrompt,
  handleTopUpStart,
  getHostelLabel,
} = require("../services/topup");
const { sendHelp, SERVER_URL } = require("../services/ui");
const {
  STAGES,
  HOSTELS,
  DEFAULT_BOT_CONFIG,
  cancelKeyboard,
  ratingKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

const fallbackState = {
  topupDisabled: process.env.TOPUP_DISABLED === "true",
};

function runtimeParts(runtime = {}) {
  return {
    state: runtime.state || fallbackState,
    config: runtime.config || DEFAULT_BOT_CONFIG,
  };
}

// ── /start ────────────────────────────────────────────────────────────────────
function registerStart(bot, runtime) {
  const { state, config } = runtimeParts(runtime);

  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id;
    track("bot_start", { chatId });
    if (chatId) resetSession(chatId, config.sessionKey);

    const payload = ctx.startPayload?.trim() ?? "";

    // Deep link while top-ups are disabled
    if (
      config.supportsTopup &&
      state.topupDisabled &&
      (isValidMeterId(payload) || /^(?:nus|sutd)_\d{8}$/.test(payload))
    ) {
      track("topup_disabled_deeplink", { chatId, payload });
      return ctx.reply(
        `⚡ ${config.displayName}\n\n${TOPUP_DISABLED_MESSAGE}`,
        config.mainKeyboard,
      );
    }

    if (config.audience === "sutd") {
      const sutdMatch = payload.match(/^(?:sutd_)?(\d{8})$/);
      if (sutdMatch) {
        const meterId = sutdMatch[1];
        track("bot_start_deeplink", {
          chatId,
          meterId,
          hostel: HOSTELS.SUTD,
        });

        const session = getSession(chatId, config.sessionKey);
        session.stage = STAGES.AWAITING_AMOUNT;
        session.hostel = HOSTELS.SUTD;
        session.txtMtrId = meterId;

        return ctx.reply(
          `⚡ ${config.displayName}\n\n` +
            `🏠 System: <b>${getHostelLabel(HOSTELS.SUTD)}</b>\n` +
            `🔌 Meter ID: <code>${meterId}</code>\n\n` +
            `Enter the amount in SGD (e.g. <code>20</code>, ${getAmountPrompt(HOSTELS.SUTD)}):\n\n` +
            `📄 By using this bot, you agree to our <a href="${SERVER_URL}/app/terms">Terms of Use</a>.`,
          { parse_mode: "HTML", reply_markup: cancelKeyboard.reply_markup },
        );
      }
    } else {
      // cp2nus deep link: /start nus_12345678
      const cp2nusMatch = payload.match(/^nus_(\d{8})$/);
      if (cp2nusMatch) {
        const meterId = cp2nusMatch[1];
        track("bot_start_deeplink", { chatId, meterId, hostel: "cp2nus" });

        const session = getSession(chatId, config.sessionKey);
        session.stage = STAGES.AWAITING_AMOUNT;
        session.hostel = HOSTELS.CP2NUS;
        session.txtMtrId = meterId;

        return ctx.reply(
          `⚡ ${config.displayName}\n\n` +
            `🏠 Hostel: <b>${getHostelLabel(HOSTELS.CP2NUS)}</b>\n` +
            `🔌 Meter ID: <code>${meterId}</code>\n\n` +
            `Enter the amount in SGD (e.g. <code>20</code>, ${getAmountPrompt(HOSTELS.CP2NUS)}):\n\n` +
            `📄 By using this bot, you agree to our <a href="${SERVER_URL}/app/terms">Terms of Use</a>.`,
          { parse_mode: "HTML", reply_markup: cancelKeyboard.reply_markup },
        );
      }

      // cp2 deep link: /start 12345678
      if (isValidMeterId(payload)) {
        track("bot_start_deeplink", { chatId, meterId: payload });
        // Stash the meter ID so startTopUp can pick it up
        const session = getSession(chatId, config.sessionKey);
        session.txtMtrId = payload;
        return handleTopUpStart(ctx, chatId, payload, config);
      }
    }

    return ctx.reply(
      `⚡ ${config.displayName}\n\nChoose an option below:\n\n` +
        `📄 By using this bot, you agree to our <a href="${SERVER_URL}/app/terms">Terms of Use</a>.`,
      { parse_mode: "HTML", reply_markup: config.mainKeyboard.reply_markup },
    );
  });
}

// ── /topup ────────────────────────────────────────────────────────────────────
function registerTopup(bot, runtime) {
  const { state, config } = runtimeParts(runtime);

  bot.command("topup", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!config.supportsTopup) {
      resetSession(chatId, config.sessionKey);
      return ctx.reply(
        "⚠️ Online top-up is not available in this bot yet. Use /balance or /topups.",
        config.mainKeyboard,
      );
    }

    if (state.topupDisabled) {
      track("topup_disabled_command", { chatId });
      resetSession(chatId, config.sessionKey);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, config.mainKeyboard);
    }

    track("topup_command", { chatId });
    return handleTopUpStart(ctx, chatId, null, config);
  });
}

// ── /balance ──────────────────────────────────────────────────────────────────
function registerBalance(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("balance", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("balance_command", { chatId });
    return handleMeterLookupStart(ctx, chatId, "balance", {
      hostel: config.defaultLookupHostel,
      allowedHostels: config.allowedHostels,
      config,
    });
  });
}

// ── /usage ────────────────────────────────────────────────────────────────────
function registerUsage(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("usage", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!config.supportsUsage) {
      resetSession(chatId, config.sessionKey);
      return ctx.reply(
        "⚠️ Usage history is not available for SUTD yet. Use /balance or /topups.",
        config.mainKeyboard,
      );
    }

    track("usage_command", { chatId });
    return handleMeterLookupStart(ctx, chatId, "usage", {
      allowedHostels: config.allowedHostels,
      config,
    });
  });
}

// ── /topups ──────────────────────────────────────────────────────────────────
function registerTopups(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("topups", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("topups_command", { chatId });
    return handleMeterLookupStart(ctx, chatId, "topups", {
      hostel: config.defaultLookupHostel,
      allowedHostels: config.allowedHostels,
      config,
    });
  });
}

// ── /forget ───────────────────────────────────────────────────────────────────
function registerForget(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("forget", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("forget_command", { chatId });
    const deleted = forgetUser(chatId, config.allowedHostels);
    resetSession(chatId, config.sessionKey);

    return ctx.reply(
      deleted
        ? "🗑️ Your saved meters have been removed.\n\nUse /topup to start a fresh top-up."
        : "ℹ️ You don't have any saved meters.",
      config.mainKeyboard,
    );
  });
}

// ── /feedback ─────────────────────────────────────────────────────────────────
function registerFeedback(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("feedback", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("feedback_command", { chatId });
    resetSession(chatId, config.sessionKey);

    const session = getSession(chatId, config.sessionKey);
    session.stage = STAGES.AWAITING_FEEDBACK_RATING;

    return ctx.reply(
      "💬 <b>Share your feedback</b>\n\nHow would you rate your experience?",
      {
        parse_mode: "HTML",
        ...ratingKeyboard(),
      },
    );
  });
}

// ── /help ─────────────────────────────────────────────────────────────────────
function registerHelp(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("help", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) track("help_command", { chatId });
    return sendHelp(ctx, config);
  });
}

// ── /cancel ───────────────────────────────────────────────────────────────────
function registerCancel(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) resetSession(chatId, config.sessionKey);
    return ctx.reply(
      config.supportsTopup
        ? "❌ Top-up cancelled. Use /topup to start again."
        : "❌ Cancelled. Use /balance or /topups when you're ready.",
      config.mainKeyboard,
    );
  });
}

// ── Register all user commands ────────────────────────────────────────────────
function registerUserCommands(bot, runtime) {
  registerStart(bot, runtime);
  registerTopup(bot, runtime);
  registerBalance(bot, runtime);
  registerUsage(bot, runtime);
  registerTopups(bot, runtime);
  registerForget(bot, runtime);
  registerFeedback(bot, runtime);
  registerHelp(bot, runtime);
  registerCancel(bot, runtime);
}

module.exports = { registerUserCommands };
