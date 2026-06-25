const { Markup } = require("telegraf");
const { escHtml } = require("../../services/utils");
const {
  getMeterSummary,
  getMeterUsage,
  formatUsageSummary,
} = require("../../services/ore");
const {
  getSutdMeterSummary,
  isValidSutdAmount,
} = require("../../services/sutdService");
const { saveUser } = require("../services/userStore");
const { track } = require("../../services/analytics");
const { isValidMeterId, isValidAmount } = require("../../services/validators");
const {
  withChatLock,
  getSession,
  resetSession,
} = require("../services/session");
const { handleMeterIdLookup } = require("../services/lookup");
const {
  getHostelLabel,
  getWebAppPath,
  getAmountPrompt,
  isHttpsUrl,
  SERVER_URL,
} = require("../services/topup");
const {
  STAGES,
  HOSTELS,
  DEFAULT_BOT_CONFIG,
  cancelKeyboard,
  ratingKeyboard,
  TOPUP_DISABLED_MESSAGE,
  TOPUP_IN_PROGRESS_STAGES,
} = require("../constants");

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

const fallbackState = {
  topupDisabled: process.env.TOPUP_DISABLED === "true",
};

function runtimeParts(runtime = {}) {
  return {
    bot: runtime.bot || null,
    pendingReplies: runtime.pendingReplies || new Map(),
    state: runtime.state || fallbackState,
    config: runtime.config || DEFAULT_BOT_CONFIG,
  };
}

function restartHint(config) {
  return config.supportsTopup
    ? "Use /topup to start a new top-up, or /help for available commands."
    : "Use /balance or /topups to check your SUTD meter, or /help for available commands.";
}

function unknownInputHint(config) {
  return config.supportsTopup
    ? "I didn't understand that. Use /topup to top up, /balance to check balance, /topups to view recent top-ups, or /help for instructions."
    : "I didn't understand that. Use /balance to check your SUTD balance, /topups to view SUTD top-ups, or /help for instructions.";
}

// ── Feedback helpers ──────────────────────────────────────────────────────────
function parseStar(text) {
  return (
    {
      "⭐ 1": 1,
      "⭐⭐ 2": 2,
      "⭐⭐⭐ 3": 3,
      "⭐⭐⭐⭐ 4": 4,
      "⭐⭐⭐⭐⭐ 5": 5,
    }[text] ?? null
  );
}

// ── Stage handlers ────────────────────────────────────────────────────────────

async function handleFeedbackRating(ctx, chatId, text, session) {
  const rating = parseStar(text);
  if (rating === null) {
    return ctx.reply(
      "⚠️ Please tap one of the star buttons to rate your experience.",
      ratingKeyboard(),
    );
  }

  session.feedbackRating = rating;
  session.stage = STAGES.AWAITING_FEEDBACK_TEXT;

  return ctx.reply(
    `${"⭐".repeat(rating)} Got it!\n\nNow please type your feedback or any comments (or tap <b>Skip</b> to submit without a message):`,
    {
      parse_mode: "HTML",
      ...Markup.keyboard([["⏭ Skip"], ["❌ Cancel"]]).resize(),
    },
  );
}

async function handleFeedbackText(ctx, chatId, text, session, runtime) {
  const { bot, pendingReplies, config } = runtime;
  const feedbackText = text === "⏭ Skip" ? null : text;
  const { feedbackRating } = session;

  track("feedback_submitted", {
    chatId,
    rating: feedbackRating,
    message: feedbackText,
  });
  console.log(
    `📝 FEEDBACK from ${chatId}: rating=${feedbackRating}`,
    feedbackText ? `| message="${feedbackText}"` : "(no message)",
  );

  resetSession(chatId, config.sessionKey);

  const stars = "⭐".repeat(feedbackRating ?? 0);
  const notifyLines = [
    `📬 <b>New Feedback</b>`,
    `👤 From: <code>${chatId}</code>`,
    `${stars} Rating: ${feedbackRating}/5`,
  ];
  if (feedbackText)
    notifyLines.push(`💬 Message: <i>${escHtml(feedbackText)}</i>`);

  // INVARIANT: sendMessage and pendingReplies.set must both stay inside this
  // guard — registering a reply thread for an undefined target is a bug.
  if (OWNER_CHAT_ID && bot) {
    const notifyMsg = await bot.telegram
      .sendMessage(OWNER_CHAT_ID, notifyLines.join("\n"), {
        parse_mode: "HTML",
      })
      .catch((err) => {
        console.error("Failed to notify owner:", err);
        return null;
      });

    if (notifyMsg) {
      pendingReplies.set(notifyMsg.message_id, {
        chatId,
        ownerMsgId: null,
        createdAt: Date.now(),
      });
    }
  }

  return ctx.reply(
    `✅ <b>Thanks for your feedback!</b>\n\n${stars}\n\n` +
      (feedbackText ? `<i>"${escHtml(feedbackText)}"</i>\n\n` : "") +
      `Your input helps us improve the bot.`,
    { parse_mode: "HTML", ...config.mainKeyboard },
  );
}

async function handleAwaitingMeterId(ctx, chatId, text, session, config) {
  if (!isValidMeterId(text)) {
    return ctx.reply("⚠️ Invalid Meter ID. Please try again.", cancelKeyboard);
  }

  session.txtMtrId = text;
  await ctx.sendChatAction("typing");
  const loadingMsg = await ctx
    .reply("🔍 Fetching meter details…")
    .catch(() => null);
  if (!loadingMsg) return;

  try {
    const isSutd = session.hostel === HOSTELS.SUTD || config.audience === "sutd";
    if (isSutd) session.hostel = HOSTELS.SUTD;
    const [summary, usage] = isSutd
      ? [await getSutdMeterSummary(text), null]
      : await Promise.all([getMeterSummary(text), getMeterUsage(text, 7)]);

    session.stage = STAGES.AWAITING_AMOUNT;

    track("meter_id_looked_up", {
      chatId,
      meterId: text,
      hasAddress: !!summary.address,
      hasBalance: summary.credit_bal != null,
    });

    const lines = [`✅ Meter ID: <code>${text}</code>`];
    if (summary.address)
      lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);

    const bal = Number(summary.credit_bal);
    if (summary.credit_bal != null && Number.isFinite(bal)) {
      lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
    }

    const usageText = usage
      ? await formatUsageSummary(usage.history, summary.credit_bal, 7, text)
      : "";
    if (usageText) {
      lines.push("", "<b>Daily consumption</b>", usageText);
    }

    lines.push(
      "",
      `Now enter the <b>amount in SGD</b> (e.g. <code>20</code> for $20.00, ${getAmountPrompt(session.hostel)}):`,
    );

    await ctx.telegram
      .editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        {
          parse_mode: "HTML",
        },
      )
      .catch(async () =>
        ctx.reply(lines.join("\n"), { parse_mode: "HTML", ...cancelKeyboard }),
      );
  } catch (err) {
    const timedOut = err.code === "ECONNABORTED";
    track("prefill_usage_error", {
      chatId,
      meterId: text,
      error: err.message,
      timedOut,
    });

    session.stage = STAGES.AWAITING_METER_ID;
    delete session.txtMtrId;

    const fallback = timedOut
      ? `⚠️ The EVS server took too long to respond. Please try again in a moment:`
      : `⚠️ Meter ID <code>${text}</code> could not be found. Please check and try again:`;

    await ctx.telegram
      .editMessageText(chatId, loadingMsg.message_id, undefined, fallback, {
        parse_mode: "HTML",
      })
      .catch(() =>
        ctx.reply(fallback, { parse_mode: "HTML", ...cancelKeyboard }),
      );
  }
}

async function handleAwaitingAmount(ctx, chatId, text, session, config) {
  if (
    !session.txtMtrId ||
    !isValidMeterId(session.txtMtrId) ||
    !session.hostel
  ) {
    resetSession(chatId, config.sessionKey);
    return ctx.reply(
      "⚠️ No valid Meter ID on record. Please enter your 8-digit Meter ID:",
      {
        ...cancelKeyboard,
        reply_markup: {
          ...cancelKeyboard.reply_markup,
          input_field_placeholder: "e.g. 12345678",
        },
      },
    );
  }

  const amt = Number(String(text).replace(/[^0-9.]/g, ""));
  const isSutd = session.hostel === HOSTELS.SUTD;
  const validAmount = isSutd ? isValidSutdAmount(amt) : isValidAmount(amt);
  if (!validAmount) {
    return ctx.reply(
      isSutd
        ? "⚠️ Please enter a valid amount between $10 and $50."
        : "⚠️ Please enter a valid amount between $6 and $50.",
    );
  }

  const amountDollars = Number(amt.toFixed(2));
  const amountCents = Math.round(amountDollars * 100);

  track("amount_accepted", {
    chatId,
    hostel: session.hostel,
    meterId: session.txtMtrId,
    amount: amountDollars,
  });

  const webAppPath = getWebAppPath(session.hostel);
  if (!webAppPath) {
    resetSession(chatId, config.sessionKey);
    return ctx.reply(
      "⚠️ Online top-up is not available for this meter system yet.",
      config.mainKeyboard,
    );
  }

  saveUser(chatId, session.txtMtrId, session.hostel);

  const webAppUrl =
    `${SERVER_URL}${webAppPath}?txtMtrId=${encodeURIComponent(session.txtMtrId)}` +
    `&txtAmount=${encodeURIComponent(amountDollars)}` +
    `&chatId=${encodeURIComponent(chatId)}`;

  session.amountDollars = amountDollars;
  session.amountCents = amountCents;
  session.webAppUrl = webAppUrl;
  session.stage = STAGES.AWAITING_PAYMENT;

  console.log("🌐 WebApp URL =", webAppUrl);

  const hostelLabel = getHostelLabel(session.hostel);
  const orderSummary =
    `📋 *Order Summary*\n\n` +
    `🏠 Hostel: *${hostelLabel}*\n` +
    `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
    `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n`;

  if (!isHttpsUrl(SERVER_URL)) {
    track("payment_button_shown", {
      chatId,
      hostel: session.hostel,
      meterId: session.txtMtrId,
      amount: amountDollars,
      webAppUrl,
      mode: "url_fallback",
    });

    await ctx.replyWithMarkdown(
      orderSummary +
        `Your \`SERVER_URL\` is \`${SERVER_URL}\`.\n` +
        `Telegram WebApp buttons require *HTTPS*, so I can't open the WebApp inside Telegram with the current SERVER_URL.\n\n` +
        `Open the payment page in your browser instead:`,
      Markup.inlineKeyboard([
        Markup.button.url("🌐 Open Payment Page", webAppUrl),
      ]),
    );
    return ctx.replyWithMarkdown(
      `For in-Telegram WebApp support, expose your server over HTTPS and set:\n\n` +
        `\`SERVER_URL=https://<your-tunnel-host>\`\n\n` +
        `then restart the bot.`,
    );
  }

  track("payment_button_shown", {
    chatId,
    hostel: session.hostel,
    meterId: session.txtMtrId,
    amount: amountDollars,
    webAppUrl,
    mode: "telegram_webapp",
  });

  return ctx.replyWithMarkdown(
    orderSummary +
      `Tap below to proceed to payment:\n\n` +
      `📄 By proceeding, you agree to our [Terms of Use](${SERVER_URL}/app/terms).`,
    Markup.keyboard([
      [Markup.button.webApp("💳 Pay Now", webAppUrl)],
      ["❌ Cancel"],
    ]).resize(),
  );
}

async function handleAwaitingPayment(ctx, session) {
  return ctx.reply(
    "💳 Please tap the Pay Now button below to continue payment, or tap ❌ Cancel to cancel.",
    Markup.keyboard([
      [Markup.button.webApp("💳 Pay Now", session.webAppUrl)],
      ["❌ Cancel"],
    ]).resize(),
  );
}

async function handleIdleUserReply(ctx, chatId, text, runtime) {
  const { bot, pendingReplies } = runtime;
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId || !pendingReplies.has(replyToId)) return false;

  const pending = pendingReplies.get(replyToId);
  const rootOwnerMsgId = pending?.ownerMsgId ?? replyToId;

  if (!pending || String(pending.chatId) !== String(chatId) || !rootOwnerMsgId)
    return false;

  if (!bot) return false;

  const sentOwnerMsg = await bot.telegram
    .sendMessage(OWNER_CHAT_ID, `↩️ <b>User reply:</b>\n\n${escHtml(text)}`, {
      parse_mode: "HTML",
      reply_to_message_id: rootOwnerMsgId,
    })
    .catch(() => null);

  if (!sentOwnerMsg) {
    await ctx.reply("⚠️ Could not forward your reply.");
    return true;
  }

  pendingReplies.set(sentOwnerMsg.message_id, {
    chatId,
    ownerMsgId: rootOwnerMsgId,
    createdAt: Date.now(),
  });

  await ctx.reply("✅ Your reply was sent.");
  return true;
}

// ── Main on("text") registration ──────────────────────────────────────────────
function registerTextHandler(telegramBot, runtime) {
  const parts = runtimeParts({ ...runtime, bot: telegramBot });
  const { state, config } = parts;

  telegramBot.on("text", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await withChatLock(chatId, async () => {
      const text = String(ctx.message?.text || "").trim();
      if (!text || text.startsWith("/")) return;

      const session = getSession(chatId, config.sessionKey);

      // Kill any in-progress top-up flow if top-ups were disabled mid-session
      if (state.topupDisabled && TOPUP_IN_PROGRESS_STAGES.has(session.stage)) {
        track("topup_disabled_existing_session", {
          chatId,
          stage: session.stage,
        });
        resetSession(chatId, config.sessionKey);
        return ctx.reply(TOPUP_DISABLED_MESSAGE, config.mainKeyboard);
      }

      switch (session.stage) {
        case STAGES.AWAITING_FEEDBACK_RATING:
          return handleFeedbackRating(ctx, chatId, text, session);

        case STAGES.AWAITING_FEEDBACK_TEXT:
          return handleFeedbackText(ctx, chatId, text, session, parts);

        case STAGES.AWAITING_METER_ID:
          return handleAwaitingMeterId(ctx, chatId, text, session, config);

        case STAGES.AWAITING_METER_ID_USAGE:
          if (!isValidMeterId(text))
            return ctx.reply(
              "⚠️ Invalid Meter ID. Please try again.",
              cancelKeyboard,
            );
          return handleMeterIdLookup(ctx, chatId, text, "usage", {
            hostel: session.lookupHostel,
            config,
          });

        case STAGES.AWAITING_METER_ID_BALANCE:
          if (!isValidMeterId(text))
            return ctx.reply(
              "⚠️ Invalid Meter ID. Please try again.",
              cancelKeyboard,
            );
          return handleMeterIdLookup(ctx, chatId, text, "balance", {
            hostel: session.lookupHostel,
            config,
          });

        case STAGES.AWAITING_METER_ID_TOPUPS:
          if (!isValidMeterId(text))
            return ctx.reply(
              "⚠️ Invalid Meter ID. Please try again.",
              cancelKeyboard,
            );
          return handleMeterIdLookup(ctx, chatId, text, "topups", {
            hostel: session.lookupHostel,
            config,
          });

        case STAGES.AWAITING_AMOUNT:
          return handleAwaitingAmount(ctx, chatId, text, session, config);

        case STAGES.AWAITING_PAYMENT:
          return handleAwaitingPayment(ctx, session);

        case STAGES.IDLE: {
          // Let users reply to developer messages even when idle
          const handled = await handleIdleUserReply(ctx, chatId, text, parts);
          if (handled) return;

          // Friendly hint for likely-stale meter ID / amount inputs
          const looksLikeMeterId = /^\d{8}$/.test(text);
          const looksLikeAmount =
            /^\d+(\.\d{1,2})?$/.test(text) &&
            Number(text) >= 6 &&
            Number(text) <= 50;

          if (looksLikeMeterId || looksLikeAmount) {
            return ctx.reply(
              `⚠️ It looks like your previous session may have expired.\n\n${restartHint(config)}`,
              config.mainKeyboard,
            );
          }

          return ctx.reply(unknownInputHint(config), config.mainKeyboard);
        }

        default:
          return ctx.reply(unknownInputHint(config), config.mainKeyboard);
      }
    }, config.sessionKey);
  });
}

module.exports = { registerTextHandler };
