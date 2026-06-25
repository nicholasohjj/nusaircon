const { track } = require("../../services/analytics");
const { resetSession, getSession } = require("../services/session");
const { setActiveSavedMeter } = require("../services/userStore");
const {
  handleMeterIdLookup,
  promptForLookupMeterId,
} = require("../services/lookup");
const { parseSavedMeterCallback } = require("../services/savedMeterPicker");
const { getAmountPrompt, getHostelLabel } = require("../services/topup");
const {
  STAGES,
  HOSTELS,
  DEFAULT_BOT_CONFIG,
  TOPUP_SUPPORTED_HOSTELS,
  cancelKeyboard,
  hostelInlineKeyboard,
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

function registerActionHandlers(bot, runtime) {
  const parts = runtimeParts(runtime);

  bot.action("hostel_cp2", makeHostelHandler(HOSTELS.CP2, parts));
  bot.action("hostel_cp2nus", makeHostelHandler(HOSTELS.CP2NUS, parts));
  bot.action(/^saved_meter:/, (ctx) => handleSavedMeterAction(ctx, parts));
}

async function handleSavedMeterAction(ctx, runtime) {
  const { state, config } = runtime;
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const parsed = parseSavedMeterCallback(ctx.callbackQuery?.data);
  if (!parsed) return ctx.answerCbQuery("Saved meter action is invalid.");

  if (state.topupDisabled && parsed.mode === "topup") {
    await ctx.answerCbQuery("Top-ups are temporarily unavailable.");
    resetSession(chatId, config.sessionKey);
    return ctx.reply(TOPUP_DISABLED_MESSAGE, config.mainKeyboard);
  }

  if (parsed.mode === "topup" && !TOPUP_SUPPORTED_HOSTELS.has(parsed.hostel)) {
    await ctx.answerCbQuery("Online top-up is not available for this system.");
    resetSession(chatId, config.sessionKey);
    return ctx.reply(
      "⚠️ Online top-up is not available for this meter system yet.",
      config.mainKeyboard,
    );
  }

  await ctx.answerCbQuery();

  if (parsed.useNew) {
    if (parsed.mode === "topup") {
      resetSession(chatId, config.sessionKey);
      const session = getSession(chatId, config.sessionKey);
      session.stage =
        config.audience === "sutd"
          ? STAGES.AWAITING_METER_ID
          : STAGES.AWAITING_HOSTEL;
      if (config.audience === "sutd") {
        session.hostel = HOSTELS.SUTD;
        return ctx.reply("🔌 Please enter your 8-digit SUTD Meter ID:", {
          ...cancelKeyboard,
          reply_markup: {
            ...cancelKeyboard.reply_markup,
            input_field_placeholder: "e.g. 20000596",
          },
        });
      }
      return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard);
    }

    return promptForLookupMeterId(ctx, chatId, parsed.mode, {
      hostel: config.defaultLookupHostel,
      config,
    });
  }

  const active = setActiveSavedMeter(chatId, parsed.meterId, parsed.hostel);
  if (!active) {
    return ctx.reply(
      "⚠️ That saved meter is no longer available. Use /topup to start again.",
      config.mainKeyboard,
    );
  }

  track("saved_meter_selected", {
    chatId,
    mode: parsed.mode,
    hostel: parsed.hostel,
    meterId: parsed.meterId,
  });

  if (parsed.mode === "topup") {
    resetSession(chatId, config.sessionKey);
    const session = getSession(chatId, config.sessionKey);
    session.stage = STAGES.AWAITING_AMOUNT;
    session.hostel = parsed.hostel;
    session.txtMtrId = parsed.meterId;

    return ctx.reply(
      `🔌 Meter ID: <code>${parsed.meterId}</code>\n` +
        `🏠 Hostel: <b>${getHostelLabel(parsed.hostel)}</b>\n\n` +
        `Enter the amount in SGD (${getAmountPrompt(parsed.hostel)}), or tap ❌ Cancel to start over.`,
      { parse_mode: "HTML", ...cancelKeyboard },
    );
  }

  return handleMeterIdLookup(ctx, chatId, parsed.meterId, parsed.mode, {
    fromSaved: true,
    hostel: parsed.hostel,
    config,
  });
}

function makeHostelHandler(hostel, runtime = {}) {
  const { state, config } = runtimeParts(runtime);

  return async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      await ctx.answerCbQuery("Top-ups are temporarily unavailable.");
      resetSession(chatId, config.sessionKey);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, config.mainKeyboard);
    }

    const session = getSession(chatId, config.sessionKey);
    if (session.stage !== STAGES.AWAITING_HOSTEL) {
      return ctx.answerCbQuery("⚠️ Please start a new top-up.");
    }
    await ctx.answerCbQuery();

    session.hostel = hostel;
    track("hostel_selected", { chatId, hostel });

    if (session.txtMtrId) {
      session.stage = STAGES.AWAITING_AMOUNT;
      return ctx.replyWithMarkdown(
        `🔌 Meter ID: \`${session.txtMtrId}\`\n\nEnter the *amount in SGD* (e.g. \`20\`, ${getAmountPrompt(session.hostel)}):`,
        cancelKeyboard,
      );
    }

    session.stage = STAGES.AWAITING_METER_ID;
    return ctx.reply("🔌 Please enter your 8-digit Meter ID:", {
      ...cancelKeyboard,
      reply_markup: {
        ...cancelKeyboard.reply_markup,
        input_field_placeholder: "e.g. 12345678",
      },
    });
  };
}

module.exports = { registerActionHandlers };
