const { botOwnedHostels } = require("../constants");
const userStore = require("./userStore");
const balanceReset = require("./balanceReset");
const { escHtml } = require("../../services/utils");

const DAY_MS = 24 * 60 * 60 * 1000;
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
// Used when no reset date has passed yet; about one semester.
const FALLBACK_WINDOW_DAYS = 120;
// Each name costs a getChatMember call.
const MAX_NAMED_PAYERS = 10;
const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);
const COUNTED_NOTE =
  "<i>Only top-ups made through this bot are counted, not ones on the EVS website or elsewhere.</i>";

function sgd(amount) {
  return `SGD ${amount.toFixed(2)}`;
}

function topupsText(count) {
  return count === 1 ? "1 top-up" : `${count} top-ups`;
}

/** When the current tally starts: the last reset, or ~a semester ago. */
function paidPeriod(audience, store = userStore, now = Date.now()) {
  const lastReset = balanceReset.getLastResetDate(audience, store, now);
  if (lastReset) {
    const [y, m, d] = lastReset.split("-").map(Number);
    return {
      since: Date.UTC(y, m - 1, d) - SGT_OFFSET_MS,
      label: `since the reset on ${balanceReset.formatResetDate(lastReset)}`,
    };
  }
  return {
    since: now - FALLBACK_WINDOW_DAYS * DAY_MS,
    label: `in the last ${FALLBACK_WINDOW_DAYS} days`,
  };
}

function sumTotals(totals) {
  return totals.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      count: acc.count + row.count,
    }),
    { total: 0, count: 0 },
  );
}

/** /paid in a private chat: this person against everyone else, no names. */
function buildPrivatePaidText(
  chatId,
  config,
  { store = userStore, now = Date.now() } = {},
) {
  const meters = store
    .getSavedMeters(chatId)
    .filter((meter) => config.allowedHostels.includes(meter.hostel));
  if (!meters.length) {
    return "ℹ️ /paid shows who has topped up your meter. You don't have a saved meter yet. Use /topup and your meter will be saved.";
  }

  const period = paidPeriod(config.audience, store, now);
  const hostels = botOwnedHostels(config);
  const blocks = meters.map((meter) => {
    const totals = store.getTopupTotals(meter.meterId, hostels, period.since);
    const lines = [
      `🔌 ${escHtml(meter.label)} (<code>${meter.meterId}</code>)`,
    ];
    if (!totals.length) {
      lines.push("No top-ups through the bot yet.");
      return lines.join("\n");
    }

    const mine = totals.find((row) => row.chatId === String(chatId));
    const others = totals.filter((row) => row !== mine);
    lines.push(
      mine
        ? `• You: ${sgd(mine.total)} (${topupsText(mine.count)})`
        : `• You: ${sgd(0)}`,
    );
    if (others.length) {
      const { total, count } = sumTotals(others);
      const who =
        others.length === 1
          ? "1 other person"
          : `${others.length} other people`;
      lines.push(`• ${who}: ${sgd(total)} (${topupsText(count)})`);
    }
    return lines.join("\n");
  });

  return [
    `🧾 <b>Who paid, ${period.label}</b>`,
    "",
    blocks.join("\n\n"),
    "",
    COUNTED_NOTE,
    "",
    "💡 Add me to your room's group chat and send /meter there to see everyone by name.",
  ].join("\n");
}

/** The member's name, or null if they aren't in this group. */
async function memberName(ctx, userId) {
  if (!/^\d+$/.test(userId)) return null;
  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      Number(userId),
    );
    const inGroup =
      MEMBER_STATUSES.has(member?.status) ||
      (member?.status === "restricted" && member.is_member);
    if (!inGroup) return null;
    const user = member.user || {};
    return (
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      (user.username ? `@${user.username}` : "A member")
    );
  } catch {
    return null;
  }
}

/**
 * /paid in a room group: names for payers who are in the group. Everyone else
 * is one combined line, so the group learns nothing about outsiders.
 */
async function buildGroupPaidText(
  ctx,
  meter,
  config,
  { store = userStore, now = Date.now() } = {},
) {
  const period = paidPeriod(config.audience, store, now);
  const totals = store.getTopupTotals(
    meter.meterId,
    botOwnedHostels(config),
    period.since,
  );
  const header = `🧾 <b>Who paid for <code>${meter.meterId}</code>, ${period.label}</b>`;
  if (!totals.length) {
    return [
      header,
      "",
      "No top-ups through the bot yet.",
      "",
      COUNTED_NOTE,
    ].join("\n");
  }

  const lines = [];
  const outsiders = [];
  for (const [index, row] of totals.entries()) {
    const name =
      index < MAX_NAMED_PAYERS ? await memberName(ctx, row.chatId) : null;
    if (name) {
      lines.push(
        `• ${escHtml(name)}: ${sgd(row.total)} (${topupsText(row.count)})`,
      );
    } else {
      outsiders.push(row);
    }
  }
  if (outsiders.length) {
    const { total, count } = sumTotals(outsiders);
    lines.push(`• Not in this group: ${sgd(total)} (${topupsText(count)})`);
  }

  return [
    header,
    "",
    ...lines,
    "",
    `<b>Total:</b> ${sgd(sumTotals(totals).total)}`,
    "",
    COUNTED_NOTE,
  ].join("\n");
}

/** Records a successful top-up for /paid. Never throws. */
function recordSuccessfulTopup(session, hostel, store = userStore) {
  try {
    const amount = Number(session?.txtAmount);
    if (
      session?.status !== "success" ||
      !session.chatId ||
      !/^\d{8}$/.test(String(session.txtMtrId || "")) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return false;
    }
    const paidAt = Number(session.completedAt) || Date.now();
    return store.recordTopupPayment({
      ref:
        session.merchantTxnRef ||
        `${session.chatId}:${session.txtMtrId}:${amount}:${paidAt}`,
      chatId: session.chatId,
      meterId: String(session.txtMtrId),
      hostel,
      amount,
      paidAt,
    });
  } catch {
    return false;
  }
}

module.exports = {
  buildGroupPaidText,
  buildPrivatePaidText,
  paidPeriod,
  recordSuccessfulTopup,
};
