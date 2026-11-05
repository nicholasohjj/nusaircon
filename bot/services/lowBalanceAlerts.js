const { Markup } = require("telegraf");
const { botContexts } = require("../bot");
const { HOSTELS, LOW_BALANCE_THRESHOLD_SGD } = require("../constants");
const { savedMeterCallbackData } = require("./savedMeterPicker");
const userStore = require("./userStore");
const { track, captureException } = require("../../services/analytics");
const { getMeterSummary } = require("../../services/ore");
const { getSutdMeterSummary } = require("../../services/sutdService");
const { escHtml } = require("../../services/utils");

const THRESHOLD_TEXT = `SGD ${LOW_BALANCE_THRESHOLD_SGD.toFixed(2)}`;

// A failed lookup gives null or "", and Number() would turn those into a
// balance of 0 and send a false alert.
function parseBalance(value) {
  if (value === null || value === undefined || value === "") return null;
  const balance = Number(value);
  return Number.isFinite(balance) ? balance : null;
}

async function fetchMeterBalance({ meterId, hostel }) {
  const summary =
    hostel === HOSTELS.SUTD
      ? await getSutdMeterSummary(meterId)
      : await getMeterSummary(meterId);
  return parseBalance(summary?.credit_bal);
}

function buildAlertMessage(meter, balance) {
  return {
    text:
      `⚠️ <b>Low balance</b>\n\n` +
      `🔌 ${escHtml(meter.label)} (<code>${meter.meterId}</code>)\n` +
      `💰 SGD ${balance.toFixed(2)}\n\n` +
      `Top up soon so your electricity doesn't run out. ` +
      `Use /alerts off to stop these messages.`,
    extra: {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "⚡ Top up",
            savedMeterCallbackData("topup", meter),
          ),
        ],
      ]),
    },
  };
}

function isBlockedByUser(err) {
  return err?.response?.error_code === 403;
}

/**
 * Sends one alert each time a meter drops below the threshold. The next alert
 * can only follow a check that sees the balance back above it.
 */
async function runLowBalanceCheck({
  store = userStore,
  contexts = botContexts,
  fetchBalance = fetchMeterBalance,
} = {}) {
  const summary = { checked: 0, alerted: 0, recovered: 0, failed: 0 };
  const balances = new Map();

  // Sharing a lookup means roommates on one meter cost one EVS request.
  function lookupBalance(meter) {
    const key = `${meter.hostel}:${meter.meterId}`;
    if (!balances.has(key)) {
      balances.set(
        key,
        Promise.resolve()
          .then(() => fetchBalance(meter))
          .catch((err) => {
            captureException(err, meter.meterId, { route: "low_balance_check" });
            return null;
          }),
      );
    }
    return balances.get(key);
  }

  for (const meter of store.getLowBalanceAlertMeters()) {
    const context = contexts.find((candidate) =>
      candidate.config.allowedHostels.includes(meter.hostel),
    );
    if (!context) continue;

    summary.checked += 1;
    const balance = await lookupBalance(meter);
    if (balance === null) {
      summary.failed += 1;
      continue;
    }

    if (balance >= LOW_BALANCE_THRESHOLD_SGD) {
      if (meter.alertSentAt) {
        store.setLowBalanceAlertSentAt(meter.chatId, meter.meterId, meter.hostel, 0);
        summary.recovered += 1;
      }
      continue;
    }

    if (meter.alertSentAt) continue;

    const { text, extra } = buildAlertMessage(meter, balance);
    try {
      await context.bot.telegram.sendMessage(meter.chatId, text, extra);
      store.setLowBalanceAlertSentAt(
        meter.chatId,
        meter.meterId,
        meter.hostel,
        Date.now(),
      );
      summary.alerted += 1;
    } catch (err) {
      summary.failed += 1;
      if (isBlockedByUser(err)) {
        store.disableLowBalanceAlertsForChat(meter.chatId);
      } else {
        captureException(err, meter.chatId, { route: "low_balance_check" });
      }
    }
  }

  return summary;
}

let activeCheck = null;

/**
 * Starts a check in the background unless one is already running.
 * @returns {boolean} whether a new check started
 */
function startLowBalanceCheck(options) {
  if (activeCheck) return false;

  activeCheck = runLowBalanceCheck(options)
    .then((summary) => track("low_balance_check_completed", summary))
    .catch((err) =>
      captureException(err, "anonymous", { route: "low_balance_check" }),
    )
    .finally(() => {
      activeCheck = null;
    });

  return true;
}

async function handleAlertsCommand(ctx, config, store = userStore) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const action = String(ctx.message?.text || "")
    .trim()
    .split(/\s+/)[1]
    ?.toLowerCase();
  const meters = store
    .getSavedMeters(chatId)
    .filter((meter) => config.allowedHostels.includes(meter.hostel));

  if (!meters.length) {
    return ctx.reply(
      "ℹ️ Low-balance alerts work on saved meters, and you don't have any yet. Use /topup and your meter will be saved.",
      config.mainKeyboard,
    );
  }

  if (action === "on" || action === "off") {
    const enabled = action === "on";
    store.setLowBalanceAlerts(chatId, config.allowedHostels, enabled);
    track("low_balance_alerts_changed", { chatId, enabled });
    return ctx.reply(
      enabled
        ? `🔔 Low-balance alerts are on for your saved meters. We check about once a day and message you when a balance drops below ${THRESHOLD_TEXT}.\n\nAlerts can be late or missed, so check your balance before you rely on it.`
        : "🔕 Low-balance alerts are off.",
      config.mainKeyboard,
    );
  }

  const lines = meters.map(
    (meter) =>
      `${meter.lowBalanceAlerts ? "🔔" : "🔕"} ${meter.label} (${meter.meterId})`,
  );
  return ctx.reply(
    `Low-balance alerts message you when a saved meter drops below ${THRESHOLD_TEXT}.\n\n` +
      `${lines.join("\n")}\n\n` +
      "Use /alerts on or /alerts off to change this.",
    config.mainKeyboard,
  );
}

module.exports = {
  handleAlertsCommand,
  parseBalance,
  runLowBalanceCheck,
  startLowBalanceCheck,
};
