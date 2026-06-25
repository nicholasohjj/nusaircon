const { escHtml } = require("../../services/utils");
const {
  getMeterSummary,
  getMeterUsage,
  getRecentTopups,
  formatUsageSummary,
  formatTopupHistory,
} = require("../../services/ore");
const {
  getSutdMeterSummary,
  getSutdMeterSummaryAndRecentTopups,
} = require("../../services/sutdService");
const { track } = require("../../services/analytics");
const { getSession } = require("./session");
const { getSavedMeters } = require("./userStore");
const {
  savedMeterPickerKeyboard,
  savedMeterPickerText,
} = require("./savedMeterPicker");
const {
  HOSTELS,
  STAGES,
  cancelKeyboard,
  DEFAULT_BOT_CONFIG,
} = require("../constants");

function lowBalanceWarning(bal) {
  const n = Number(bal);
  if (!Number.isFinite(n) || n >= 5) return null;
  return `⚠️ <b>Low balance:</b> Your balance is SGD ${n.toFixed(2)}. Consider topping up soon.`;
}

const LOOKUP_STAGES = {
  balance: STAGES.AWAITING_METER_ID_BALANCE,
  usage: STAGES.AWAITING_METER_ID_USAGE,
  topups: STAGES.AWAITING_METER_ID_TOPUPS,
};

function lookupPrompt(mode, hostel = null) {
  const prefix = hostel === HOSTELS.SUTD ? "SUTD " : "";
  const prompts = {
    balance: `🔌 Please enter your 8-digit ${prefix}Meter ID to check your balance:`,
    usage: "🔌 Please enter your 8-digit Meter ID to view the last 7 days of usage:",
    topups: `🔌 Please enter your 8-digit ${prefix}Meter ID to view recent top-ups:`,
  };
  return prompts[mode] || "🔌 Please enter your 8-digit Meter ID:";
}

function meterIdReplyOptions() {
  return {
    ...cancelKeyboard,
    reply_markup: {
      ...cancelKeyboard.reply_markup,
      input_field_placeholder: "e.g. 12345678",
    },
  };
}

function promptForLookupMeterId(
  ctx,
  chatId,
  mode,
  { hostel = null, config = DEFAULT_BOT_CONFIG } = {},
) {
  const session = getSession(chatId, config.sessionKey);
  session.stage = LOOKUP_STAGES[mode];
  session.lookupHostel = hostel;

  return ctx.reply(lookupPrompt(mode, hostel), meterIdReplyOptions());
}

function handleMeterLookupStart(
  ctx,
  chatId,
  mode,
  {
    hostel = null,
    allowedHostels = null,
    config = DEFAULT_BOT_CONFIG,
  } = {},
) {
  const allowed = Array.isArray(allowedHostels)
    ? new Set(allowedHostels)
    : null;
  const savedMeters = getSavedMeters(chatId).filter(
    (meter) => !allowed || allowed.has(meter.hostel),
  );

  if (savedMeters.length > 1) {
    getSession(chatId, config.sessionKey).stage = STAGES.IDLE;
    return ctx.reply(
      savedMeterPickerText(mode),
      savedMeterPickerKeyboard(mode, savedMeters),
    );
  }

  if (savedMeters.length === 1) {
    getSession(chatId, config.sessionKey).stage = STAGES.IDLE;
    return handleMeterIdLookup(ctx, chatId, savedMeters[0].meterId, mode, {
      fromSaved: true,
      hostel: savedMeters[0].hostel,
      config,
    });
  }

  return promptForLookupMeterId(ctx, chatId, mode, { hostel, config });
}

/**
 * Fetches meter balance, 7-day usage, or recent top-ups, edits a loading
 * message in-place, then prompts the user to choose their next action.
 *
 * @param {"balance"|"usage"|"topups"} mode
 * @param {{ fromSaved?: boolean, hostel?: string }} opts
 */
async function handleMeterIdLookup(
  ctx,
  chatId,
  meterId,
  mode,
  {
    fromSaved = false,
    hostel = null,
    config = DEFAULT_BOT_CONFIG,
  } = {},
) {
  const session = getSession(chatId, config.sessionKey);
  session.stage = "idle";
  const lookupHostel = hostel || session.lookupHostel || null;
  delete session.lookupHostel;
  const isSutd = lookupHostel === HOSTELS.SUTD;
  const modeLabels = {
    balance: "balance",
    usage: "usage history",
    topups: "top-up history",
  };
  const loadingText = {
    balance: "🔍 Checking balance…",
    usage: "🔍 Checking recent usage…",
    topups: "🔍 Checking recent top-ups…",
  };

  await ctx.sendChatAction("typing");
  const loadingMsg = await ctx
    .reply(loadingText[mode] || "🔍 Checking meter details…")
    .catch(() => null);
  if (!loadingMsg) return;

  try {
    if (isSutd && mode === "usage") {
      throw new Error("Usage history is not available for SUTD yet.");
    }

    let summary;
    let usage;
    let topups;

    if (mode === "usage") {
      [summary, usage] = await Promise.all([
        getMeterSummary(meterId),
        getMeterUsage(meterId, 7),
      ]);
    } else if (mode === "topups") {
      if (isSutd) {
        const sutdLookup = await getSutdMeterSummaryAndRecentTopups(meterId, {
          numberOfTopups: 10,
        });
        summary = sutdLookup.summary;
        topups = sutdLookup.topups;
      } else {
        [summary, topups] = await Promise.all([
          getMeterSummary(meterId),
          getRecentTopups(meterId, { numberOfTopups: 10, lookbackDays: 90 }),
        ]);
      }
    } else {
      summary = isSutd
        ? await getSutdMeterSummary(meterId)
        : await getMeterSummary(meterId);
    }

    const lines = [`⚡ <b>Meter ID:</b> <code>${meterId}</code>`];

    if (summary.address)
      lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);

    const bal = Number(summary.credit_bal);
    if (summary.credit_bal != null && Number.isFinite(bal)) {
      lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
    } else if (mode === "balance") {
      lines.push(`💰 <b>Balance:</b> unavailable`);
    }

    const warn = lowBalanceWarning(summary.credit_bal);
    if (warn) lines.push(`\n${warn}`);

    if (mode === "usage") {
      lines.push("", "<b>Daily consumption (last 7 days)</b>");
      lines.push(
        (await formatUsageSummary(
          usage.history,
          summary.credit_bal,
          7,
          meterId,
        )) || "No usage data available.",
      );
    }

    if (mode === "topups") {
      lines.push(
        "",
        isSutd
          ? "<b>Recent SUTD top-ups</b>"
          : "<b>Recent top-ups (last 90 days)</b>",
      );
      lines.push(formatTopupHistory(topups.history));
    }

    if (fromSaved) {
      lines.push(
        "",
        `💡 <i>Showing saved meter <code>${meterId}</code>. Use /forget to change.</i>`,
      );
    }

    const edited = await ctx.telegram
      .editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        {
          parse_mode: "HTML",
        },
      )
      .catch(async () => {
        await ctx.reply(lines.join("\n"), {
          parse_mode: "HTML",
          ...config.mainKeyboard,
        });
        return null;
      });

    if (edited) return ctx.reply("Choose an option:", config.mainKeyboard);
  } catch (err) {
    track(`${mode}_error`, {
      chatId,
      meterId,
      hostel: lookupHostel || "",
      error: err.message,
    });

    const errorText =
      err.message === "Usage history is not available for SUTD yet."
        ? `⚠️ ${err.message}`
        : `⚠️ Failed to fetch ${modeLabels[mode] || "meter details"}. Please try again.`;
    const edited = await ctx.telegram
      .editMessageText(chatId, loadingMsg.message_id, undefined, errorText)
      .catch(async () => {
        await ctx.reply(errorText, config.mainKeyboard);
        return null;
      });

    if (edited) return ctx.reply("Choose an option:", config.mainKeyboard);
  }
}

module.exports = {
  handleMeterIdLookup,
  handleMeterLookupStart,
  lowBalanceWarning,
  promptForLookupMeterId,
};
