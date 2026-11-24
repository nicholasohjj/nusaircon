const { Markup } = require("telegraf");
const { HOSTELS, LOW_BALANCE_THRESHOLD_SGD } = require("../constants");
const userStore = require("./userStore");
const { topupStartUrl } = require("./roommateShare");
const { track } = require("../../services/analytics");
const { getMeterSummary } = require("../../services/ore");
const { getSutdMeterSummary } = require("../../services/sutdService");
const { escHtml } = require("../../services/utils");

// Saved meters offered when the query is empty. Each one is an EVS lookup.
const MAX_SAVED_CARDS = 3;
const CACHE_SECONDS = 30;

function meterHostel(config) {
  return config.audience === "sutd" ? HOSTELS.SUTD : HOSTELS.CP2NUS;
}

function fetchMeterSummary(meterId, hostel) {
  return hostel === HOSTELS.SUTD
    ? getSutdMeterSummary(meterId)
    : getMeterSummary(meterId);
}

function checkedAt(now) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(now));
}

function parseBalance(value) {
  if (value === null || value === undefined || value === "") return null;
  const balance = Number(value);
  return Number.isFinite(balance) ? balance : null;
}

/** The message a card posts into the chat. */
function buildCardText({ meterId, summary, now = Date.now() }) {
  const balance = parseBalance(summary?.credit_bal);
  const lines = [`⚡ <b>Meter</b> <code>${meterId}</code>`];
  if (summary?.address) lines.push(`🏠 ${escHtml(summary.address)}`);
  lines.push(
    balance === null
      ? "💰 Balance: unavailable"
      : `💰 Balance: <b>SGD ${balance.toFixed(2)}</b>`,
  );
  if (balance !== null && balance < LOW_BALANCE_THRESHOLD_SGD) {
    lines.push("⚠️ Running low. Top up soon.");
  }
  lines.push(`🕒 Checked ${checkedAt(now)}`);
  return lines.join("\n");
}

function topupKeyboard(username, audience, meterId, source) {
  if (!username) return null;
  return Markup.inlineKeyboard([
    [
      Markup.button.url(
        "⚡ Top up",
        topupStartUrl(username, audience, meterId, source),
      ),
    ],
  ]);
}

function buildCardResult({ meter, summary, config, username, now }) {
  const balance = parseBalance(summary?.credit_bal);
  const name = meter.label || `Meter ${meter.meterId}`;
  const keyboard = topupKeyboard(
    username,
    config.audience,
    meter.meterId,
    "card",
  );
  return {
    type: "article",
    id: `${meter.hostel}:${meter.meterId}`,
    title:
      balance === null
        ? `${name}: balance unavailable`
        : `${name}: SGD ${balance.toFixed(2)}`,
    description: summary?.address
      ? `${summary.address} · Tap to send`
      : "Tap to send the balance to this chat",
    input_message_content: {
      message_text: buildCardText({ meterId: meter.meterId, summary, now }),
      parse_mode: "HTML",
    },
    ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}),
  };
}

/**
 * Inline mode: "@bot 12345678" in any chat, or "@bot" alone for the person's
 * saved meters, posts a balance card with a Top up button.
 */
async function handleInlineQuery(
  ctx,
  config,
  {
    store = userStore,
    fetchSummary = fetchMeterSummary,
    now = Date.now(),
  } = {},
) {
  const query = String(ctx.inlineQuery?.query || "").trim();
  const userId = ctx.from?.id;
  const username = ctx.botInfo?.username || null;
  const fromSaved = query === "";

  let meters = [];
  if (/^\d{8}$/.test(query)) {
    meters = [{ meterId: query, hostel: meterHostel(config), label: null }];
  } else if (fromSaved && userId) {
    meters = store
      .getSavedMeters(userId)
      .filter((meter) => config.allowedHostels.includes(meter.hostel))
      .slice(0, MAX_SAVED_CARDS);
  }

  const results = (
    await Promise.all(
      meters.map(async (meter) => {
        try {
          const summary = await fetchSummary(meter.meterId, meter.hostel);
          return buildCardResult({ meter, summary, config, username, now });
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  if (meters.length) {
    track("inline_card_query", {
      chatId: userId,
      source: fromSaved ? "saved" : "typed",
      results: results.length,
    });
  }

  return ctx.answerInlineQuery(results, {
    cache_time: CACHE_SECONDS,
    // Saved meters differ per person, so their results can't be shared.
    is_personal: fromSaved,
    ...(results.length
      ? {}
      : {
          button: {
            text: query
              ? "Type an 8-digit meter ID"
              : "Save a meter first: open the bot",
            start_parameter: "inline",
          },
        }),
  });
}

function registerInlineCards(bot, runtime) {
  bot.on("inline_query", (ctx) =>
    handleInlineQuery(ctx, runtime.config).catch(() =>
      ctx.answerInlineQuery([], { cache_time: 0 }).catch(() => {}),
    ),
  );
}

module.exports = {
  buildCardText,
  fetchMeterSummary,
  handleInlineQuery,
  meterHostel,
  registerInlineCards,
  topupKeyboard,
};
