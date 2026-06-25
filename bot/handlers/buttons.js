const { track } = require("../../services/analytics");
const { resetSession } = require("../services/session");
const { handleMeterLookupStart } = require("../services/lookup");
const { handleTopUpStart } = require("../services/topup");
const { sendHelp } = require("../services/ui");
const {
  DEFAULT_BOT_CONFIG,
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

function registerButtonHandlers(bot, runtime) {
  const { state, config } = runtimeParts(runtime);

  // ── ⚡ Top Up ───────────────────────────────────────────────────────────────
  bot.hears("⚡ Top Up", async (ctx) => {
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
      track("topup_disabled_button", { chatId });
      resetSession(chatId, config.sessionKey);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, config.mainKeyboard);
    }

    track("topup_button", { chatId });
    return handleTopUpStart(ctx, chatId, null, config);
  });

  // ── 💰 Balance ──────────────────────────────────────────────────────────────
  bot.hears("💰 Balance", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("balance_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "balance", {
      hostel: config.defaultLookupHostel,
      allowedHostels: config.allowedHostels,
      config,
    });
  });

  // ── 📊 Usage ────────────────────────────────────────────────────────────────
  bot.hears("📊 Usage", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!config.supportsUsage) {
      resetSession(chatId, config.sessionKey);
      return ctx.reply(
        "⚠️ Usage history is not available for SUTD yet. Use /balance or /topups.",
        config.mainKeyboard,
      );
    }

    track("usage_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "usage", {
      allowedHostels: config.allowedHostels,
      config,
    });
  });

  // ── 🧾 Top-ups ─────────────────────────────────────────────────────────────
  bot.hears("🧾 Top-ups", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("topups_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "topups", {
      hostel: config.defaultLookupHostel,
      allowedHostels: config.allowedHostels,
      config,
    });
  });

  // ── ℹ️ Help ─────────────────────────────────────────────────────────────────
  bot.hears("ℹ️ Help", (ctx) => sendHelp(ctx, config));

  // ── ❌ Cancel ───────────────────────────────────────────────────────────────
  bot.hears("❌ Cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      track("topup_cancelled", { chatId });
      resetSession(chatId, config.sessionKey);
    }
    return ctx.reply(
      config.supportsTopup
        ? "❌ Top-up cancelled. Use /topup to start again."
        : "❌ Cancelled. Use /balance or /topups when you're ready.",
      config.mainKeyboard,
    );
  });
}

module.exports = { registerButtonHandlers };
