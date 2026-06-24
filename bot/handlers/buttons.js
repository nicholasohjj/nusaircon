const { track } = require("../../services/analytics");
const { resetSession } = require("../services/session");
const { handleMeterLookupStart } = require("../services/lookup");
const { handleTopUpStart } = require("../services/topup");
const { sendHelp } = require("../services/ui");
const { state } = require("../bot");
const {
  mainKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

function registerButtonHandlers(bot) {
  // ── ⚡ Top Up ───────────────────────────────────────────────────────────────
  bot.hears("⚡ Top Up", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      track("topup_disabled_button", { chatId });
      resetSession(chatId);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
    }

    track("topup_button", { chatId });
    return handleTopUpStart(ctx, chatId);
  });

  // ── 💰 Balance ──────────────────────────────────────────────────────────────
  bot.hears("💰 Balance", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("balance_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "balance");
  });

  // ── 📊 Usage ────────────────────────────────────────────────────────────────
  bot.hears("📊 Usage", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("usage_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "usage");
  });

  // ── 🧾 Top-ups ─────────────────────────────────────────────────────────────
  bot.hears("🧾 Top-ups", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("topups_button", { chatId });
    return handleMeterLookupStart(ctx, chatId, "topups");
  });

  // ── ℹ️ Help ─────────────────────────────────────────────────────────────────
  bot.hears("ℹ️ Help", sendHelp);

  // ── ❌ Cancel ───────────────────────────────────────────────────────────────
  bot.hears("❌ Cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      track("topup_cancelled", { chatId });
      resetSession(chatId);
    }
    return ctx.reply(
      "❌ Top-up cancelled. Use /topup to start again.",
      mainKeyboard,
    );
  });
}

module.exports = { registerButtonHandlers };
