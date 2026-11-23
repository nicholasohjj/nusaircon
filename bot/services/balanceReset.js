const { HOSTELS } = require("../constants");
const userStore = require("./userStore");
const { getMeterUsage, analyzeUsage } = require("../../services/ore");
const { escHtml } = require("../../services/utils");

// How close to the reset date top-ups get the "you may lose this" note.
const ADVICE_WINDOW_DAYS = 28;
// Reminders go out when the reset is this many days away or closer.
const REMINDER_STAGES = [14, 3];
// Below this, a projected leftover is not worth a message.
const MIN_LOSS_SGD = 2;
const USAGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function settingKey(audience) {
  return `reset_date:${audience}`;
}

/** Accepts YYYY-MM-DD and returns it only if it is a real calendar date. */
function parseResetDate(text) {
  const match = String(text || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? match[0]
    : null;
}

/** All saved reset dates for a bot, oldest first, past ones included. */
function getResetDates(audience, store = userStore) {
  const saved = String(store.getSetting(settingKey(audience)) || "");
  const dates = saved.split(",").map(parseResetDate).filter(Boolean);
  return [...new Set(dates)].sort();
}

/** Replaces a bot's reset dates; an empty list clears them. */
function setResetDates(audience, dates, store = userStore) {
  const clean = [...new Set((dates || []).map(parseResetDate))]
    .filter(Boolean)
    .sort();
  store.setSetting(settingKey(audience), clean.join(",") || null);
}

/** The next reset date that is today or later, or null if none is left. */
function getResetDate(audience, store = userStore, now = Date.now()) {
  return (
    getResetDates(audience, store).find((date) => daysUntil(date, now) >= 0) ??
    null
  );
}

function todayInSingapore(now = Date.now()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(new Date(now));
}

/** Whole days from today (Singapore time) to the date; negative once past. */
function daysUntil(date, now = Date.now()) {
  const toUtc = (text) => {
    const [y, m, d] = text.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(date) - toUtc(todayInSingapore(now))) / DAY_MS);
}

function formatResetDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function daysText(days) {
  if (days === 0) return "today";
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

function minTopup(hostel) {
  return hostel === HOSTELS.SUTD ? 10 : 6;
}

function sgd(amount) {
  return `SGD ${amount.toFixed(2)}`;
}

function usable(value) {
  return Number.isFinite(value) ? value : null;
}

/** Average daily spend over the last week, or null if EVS has none. */
async function fetchAverageDaily(meterId) {
  const usage = await getMeterUsage(meterId, USAGE_DAYS);
  const { avgDaily } = analyzeUsage(usage?.history || []);
  return avgDaily > 0 ? avgDaily : null;
}

/**
 * The note shown before a top-up when the reset is near, or null when it is
 * not near or no date is set.
 */
function buildTopupAdvice({ resetDate, daysLeft, hostel, balance, avgDaily }) {
  if (!resetDate || daysLeft < 0 || daysLeft > ADVICE_WINDOW_DAYS) return null;

  const when = formatResetDate(resetDate);
  const lines = [
    `📅 <b>Balances reset ${daysText(daysLeft)} (${when}).</b> Any credit left then is forfeited.`,
  ];
  balance = usable(balance);
  avgDaily = usable(avgDaily);

  if (daysLeft === 0) {
    lines.push("", "A top-up now will most likely be lost.");
    return lines.join("\n");
  }

  if (balance === null || avgDaily === null) {
    lines.push(
      "",
      balance === null
        ? "Only top up what you'll use before then."
        : `You have ${sgd(balance)}. Only top up what you'll use before then.`,
    );
    return lines.join("\n");
  }

  const need = avgDaily * daysLeft;
  const shortfall = need - balance;
  lines.push(
    "",
    `At your recent ~${sgd(avgDaily)}/day you'll use about ${sgd(need)} by then, and you have ${sgd(balance)}.`,
  );

  if (shortfall <= 0) {
    lines.push(
      "That should be enough, so you may not need to top up. Anything you add now will likely be forfeited.",
    );
  } else {
    const minimum = minTopup(hostel);
    lines.push(
      shortfall <= minimum
        ? `You'll need about ${sgd(shortfall)} more, so the minimum top-up of ${sgd(minimum)} should cover it.`
        : `You'll need about ${sgd(shortfall)} more. Anything above that will likely be forfeited.`,
    );
  }

  lines.push("", `<i>Estimated from the last ${USAGE_DAYS} days of usage.</i>`);
  return lines.join("\n");
}

// Required lazily: lowBalanceAlerts loads this module.
function defaultFetchBalance(meter) {
  return require("./lowBalanceAlerts").fetchMeterBalance(meter);
}

/**
 * Sends the reset note after the amount prompt. Never throws, so a failed
 * lookup cannot get in the way of the top-up itself.
 */
async function sendTopupAdvice(
  ctx,
  { meterId, hostel, config, balance, avgDaily },
  {
    store = userStore,
    now = Date.now(),
    fetchBalance = defaultFetchBalance,
    fetchAverage = fetchAverageDaily,
  } = {},
) {
  try {
    const resetDate = getResetDate(config.audience, store, now);
    if (!resetDate) return null;
    const daysLeft = daysUntil(resetDate, now);
    if (daysLeft < 0 || daysLeft > ADVICE_WINDOW_DAYS) return null;

    const lookups = [];
    if (balance === undefined) {
      lookups.push(
        Promise.resolve()
          .then(() => fetchBalance({ meterId, hostel }))
          .catch(() => null)
          .then((value) => (balance = value)),
      );
    }
    if (avgDaily === undefined && hostel !== HOSTELS.SUTD && daysLeft > 0) {
      lookups.push(
        fetchAverage(meterId)
          .catch(() => null)
          .then((value) => (avgDaily = value)),
      );
    }
    await Promise.all(lookups);

    const text = buildTopupAdvice({
      resetDate,
      daysLeft,
      hostel,
      balance: balance ?? null,
      avgDaily: avgDaily ?? null,
    });
    if (!text) return null;
    return await ctx.reply(text, { parse_mode: "HTML" });
  } catch {
    return null;
  }
}

function dueReminderStage(daysLeft) {
  if (daysLeft < 0) return null;
  const due = REMINDER_STAGES.filter((stage) => daysLeft <= stage);
  return due.length ? Math.min(...due) : null;
}

function buildReminder({ meter, resetDate, daysLeft, balance, avgDaily }) {
  const when = formatResetDate(resetDate);
  const leftover = avgDaily === null ? balance : balance - avgDaily * daysLeft;
  if (leftover < MIN_LOSS_SGD) return null;

  const projection =
    avgDaily === null
      ? `Anything still on the meter on ${when} is forfeited.`
      : `At your recent ~${sgd(avgDaily)}/day, about ${sgd(leftover)} will be left on ${when} and forfeited.`;

  return (
    `📅 <b>Balance reset ${daysText(daysLeft)}</b>\n\n` +
    `🔌 ${escHtml(meter.label)} (<code>${meter.meterId}</code>)\n` +
    `💰 ${sgd(balance)} now. ${projection}\n\n` +
    `You likely don't need to top up before then. ` +
    `Use /alerts off to stop these messages.`
  );
}

module.exports = {
  ADVICE_WINDOW_DAYS,
  MIN_LOSS_SGD,
  buildReminder,
  buildTopupAdvice,
  daysUntil,
  dueReminderStage,
  fetchAverageDaily,
  formatResetDate,
  getResetDate,
  getResetDates,
  parseResetDate,
  sendTopupAdvice,
  setResetDates,
  todayInSingapore,
};
