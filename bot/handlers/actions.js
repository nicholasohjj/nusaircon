const { track } = require("../../services/analytics");
const { resetSession, getSession } = require("../services/session");
const { setActiveSavedMeter } = require("../services/userStore");
const {
  handleMeterIdLookup,
  promptForLookupMeterId,
} = require("../services/lookup");
const { parseSavedMeterCallback } = require("../services/savedMeterPicker");
const { getHostelLabel } = require("../services/topup");
const { state } = require("../bot");
const {
  STAGES,
  HOSTELS,
  mainKeyboard,
  cancelKeyboard,
  hostelInlineKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

function registerActionHandlers(bot) {
  bot.action("hostel_cp2", makeHostelHandler(HOSTELS.CP2));
  bot.action("hostel_cp2nus", makeHostelHandler(HOSTELS.CP2NUS));
  bot.action(/^saved_meter:/, handleSavedMeterAction);
}

async function handleSavedMeterAction(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const parsed = parseSavedMeterCallback(ctx.callbackQuery?.data);
  if (!parsed) return ctx.answerCbQuery("Saved meter action is invalid.");

  if (state.topupDisabled && parsed.mode === "topup") {
    await ctx.answerCbQuery("Top-ups are temporarily unavailable.");
    resetSession(chatId);
    return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
  }

  await ctx.answerCbQuery();

  if (parsed.useNew) {
    if (parsed.mode === "topup") {
      resetSession(chatId);
      const session = getSession(chatId);
      session.stage = STAGES.AWAITING_HOSTEL;
      return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard);
    }

    return promptForLookupMeterId(ctx, chatId, parsed.mode);
  }

  const active = setActiveSavedMeter(chatId, parsed.meterId, parsed.hostel);
  if (!active) {
    return ctx.reply(
      "⚠️ That saved meter is no longer available. Use /topup to start again.",
      mainKeyboard,
    );
  }

  track("saved_meter_selected", {
    chatId,
    mode: parsed.mode,
    hostel: parsed.hostel,
    meterId: parsed.meterId,
  });

  if (parsed.mode === "topup") {
    resetSession(chatId);
    const session = getSession(chatId);
    session.stage = STAGES.AWAITING_AMOUNT;
    session.hostel = parsed.hostel;
    session.txtMtrId = parsed.meterId;

    return ctx.reply(
      `🔌 Meter ID: <code>${parsed.meterId}</code>\n` +
        `🏠 Hostel: <b>${getHostelLabel(parsed.hostel)}</b>\n\n` +
        `Enter the amount in SGD (min $6, max $50), or tap ❌ Cancel to start over.`,
      { parse_mode: "HTML", ...cancelKeyboard },
    );
  }

  return handleMeterIdLookup(ctx, chatId, parsed.meterId, parsed.mode, {
    fromSaved: true,
  });
}

function makeHostelHandler(hostel) {
  return async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      await ctx.answerCbQuery("Top-ups are temporarily unavailable.");
      resetSession(chatId);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
    }

    const session = getSession(chatId);
    if (session.stage !== STAGES.AWAITING_HOSTEL) {
      return ctx.answerCbQuery("⚠️ Please start a new top-up.");
    }
    await ctx.answerCbQuery();

    session.hostel = hostel;
    track("hostel_selected", { chatId, hostel });

    if (session.txtMtrId) {
      session.stage = STAGES.AWAITING_AMOUNT;
      return ctx.replyWithMarkdown(
        `🔌 Meter ID: \`${session.txtMtrId}\`\n\nEnter the *amount in SGD* (e.g. \`20\`, min $6, max $50):`,
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
