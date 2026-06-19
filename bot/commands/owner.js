const { escHtml } = require("../../services/utils");
const {
  getAllChatIds,
  getActiveChatIds,
  getUserStats,
  forgetUser,
} = require("../services/userStore");
const { pendingReplies, state } = require("../bot");
const { inferRuntimeMode } = require("../runtimeMode");
const { track } = require("../../services/analytics");
const { getSessionStats } = require("../services/session");
const { getPaymentSubmitLockStats } = require("../../services/paymentSubmitLock");

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

function isOwner(ctx) {
  return OWNER_CHAT_ID && String(ctx.chat?.id) === String(OWNER_CHAT_ID);
}

function formatUptime(startedAt, now = Date.now()) {
  if (!startedAt) return "not started";

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatStageCounts(byStage = {}) {
  const entries = Object.entries(byStage).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (!entries.length) return "none";
  return entries.map(([stage, count]) => `${stage}: ${count}`).join(", ");
}

function buildOwnerStatsMessage({
  state: runtimeState,
  userStats,
  sessionStats,
  pendingReplyCount,
  submitLockStats,
  now = Date.now(),
}) {
  const runtimeMode = runtimeState.runtimeMode || inferRuntimeMode();
  const topupStatus = runtimeState.topupDisabled ? "disabled" : "enabled";
  const paymentSecret = process.env.PAYMENT_SESSION_SECRET
    ? "dedicated"
    : "bot token fallback";

  return [
    "📊 Bot Stats",
    "",
    `Top-ups: ${topupStatus}`,
    `Runtime: ${runtimeMode}`,
    `Uptime: ${formatUptime(runtimeState.startedAt, now)}`,
    `Payment token secret: ${paymentSecret}`,
    "",
    `Saved users: ${userStats.total}`,
    `Active users (30d): ${userStats.active}`,
    "",
    `Bot sessions: ${sessionStats.total}`,
    `Session stages: ${formatStageCounts(sessionStats.byStage)}`,
    `Queued handlers: ${sessionStats.queuedHandlers}`,
    `Locked chats: ${sessionStats.lockedChats}`,
    "",
    `Pending owner replies: ${pendingReplyCount}`,
    `Active payment submit locks: ${submitLockStats.active}`,
  ].join("\n");
}

// ── /broadcast ────────────────────────────────────────────────────────────────
function registerBroadcast(bot) {
  bot.command("broadcast", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/broadcast\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /broadcast <message>");

    const chatIds = getAllChatIds();
    if (!chatIds.length) return ctx.reply("No known users to broadcast to.");

    await ctx.reply(`📡 Broadcasting to ${chatIds.length} user(s)…`);

    let sent = 0;
    let failed = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `📢 <b>Message from the developer:</b>\n\n${escHtml(message)}`,
          { parse_mode: "HTML" },
        );
        sent++;
      } catch (err) {
        if (err.response?.error_code === 403) forgetUser(chatId);
        failed++;
      }
      await new Promise((res) => setTimeout(res, 50));
    }

    track("broadcast_sent", {
      chatId: ctx.chat?.id,
      total: chatIds.length,
      sent,
      failed,
    });

    return ctx.reply(
      `✅ Broadcast complete. Sent: ${sent}, Failed: ${failed}.`,
    );
  });
}

function registerAnnounce(bot) {
  bot.command("announce", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/announce\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /announce <message>");

    const chatIds = getActiveChatIds(); // last 30 days
    if (!chatIds.length)
      return ctx.reply("No active users in the last 30 days.");

    await ctx.reply(`📡 Announcing to ${chatIds.length} active user(s)…`);

    let sent = 0;
    let failed = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `📢 <b>Message from the developer:</b>\n\n${escHtml(message)}`,
          { parse_mode: "HTML" },
        );
        sent++;
      } catch (err) {
        if (err.response?.error_code === 403) forgetUser(chatId);
        failed++;
      }
      await new Promise((res) => setTimeout(res, 50));
    }

    track("announce_sent", {
      chatId: ctx.chat?.id,
      total: chatIds.length,
      sent,
      failed,
    });

    return ctx.reply(`✅ Announce complete. Sent: ${sent}, Failed: ${failed}.`);
  });
}

// ── /topupoff / /topupon / /topupstatus ───────────────────────────────────────
function registerTopupToggle(bot) {
  bot.command("topupoff", async (ctx) => {
    if (!isOwner(ctx)) return;
    state.topupDisabled = true;
    track("topup_toggled", { chatId: ctx.chat?.id, enabled: false });
    console.log("⛔ Top-ups disabled by owner via /topupoff");
    return ctx.reply(
      "⛔ Top-ups are now *disabled*. Users will see the maintenance message.\n\nUse /topupon to re-enable.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("topupon", async (ctx) => {
    if (!isOwner(ctx)) return;
    state.topupDisabled = false;
    track("topup_toggled", { chatId: ctx.chat?.id, enabled: true });
    console.log("✅ Top-ups enabled by owner via /topupon");
    return ctx.reply(
      "✅ Top-ups are now *enabled*. Users can top up again.\n\nUse /topupoff to disable.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("topupstatus", async (ctx) => {
    if (!isOwner(ctx)) return;
    return ctx.reply(
      state.topupDisabled
        ? "⛔ Top-ups are currently *disabled*. Use /topupon to enable."
        : "✅ Top-ups are currently *enabled*. Use /topupoff to disable.",
      { parse_mode: "Markdown" },
    );
  });
}

function registerStats(bot) {
  bot.command("stats", async (ctx) => {
    if (!isOwner(ctx)) return;

    const userStats = getUserStats();
    const sessionStats = getSessionStats();
    const submitLockStats = getPaymentSubmitLockStats();
    const message = buildOwnerStatsMessage({
      state,
      userStats,
      sessionStats,
      pendingReplyCount: pendingReplies.size,
      submitLockStats,
    });

    track("owner_stats_requested", {
      chatId: ctx.chat?.id,
      savedUsers: userStats.total,
      activeUsers: userStats.active,
    });

    return ctx.reply(message);
  });
}

function registerOwnerCommands(bot) {
  registerBroadcast(bot);
  registerAnnounce(bot);
  registerTopupToggle(bot);
  registerStats(bot);
}

module.exports = {
  buildOwnerStatsMessage,
  formatStageCounts,
  formatUptime,
  registerOwnerCommands,
  isOwner,
};
