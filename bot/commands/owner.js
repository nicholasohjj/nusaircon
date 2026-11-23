const { escHtml } = require("../../services/utils");
const {
  getAllChatIds,
  getActiveChatIds,
  getUserStats,
  getLowBalanceAlertStats,
  forgetUser,
} = require("../services/userStore");
const { inferRuntimeMode } = require("../runtimeMode");
const { botOwnedHostels, DEFAULT_BOT_CONFIG } = require("../constants");
const { track } = require("../../services/analytics");
const { getSessionStats } = require("../services/session");
const { getPaymentSubmitLockStats } = require("../../services/paymentSubmitLock");
const { buildOwnerStatus } = require("../services/ownerStatus");
const balanceReset = require("../services/balanceReset");
const {
  getGlobalMaintenanceStatus,
  setGlobalMaintenanceEnabled,
} = require("../../services/maintenanceMode");

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
  alertStats = { users: 0, meters: 0, alerted: 0, byHostel: {} },
  sessionStats,
  pendingReplyCount,
  submitLockStats,
  now = Date.now(),
}) {
  const runtimeMode = runtimeState.runtimeMode || inferRuntimeMode();
  const topupStatus = runtimeState.topupDisabled ? "disabled" : "enabled";
  const maintenanceStatus = getGlobalMaintenanceStatus().enabled
    ? "active"
    : "inactive";
  const paymentSecret = process.env.PAYMENT_SESSION_SECRET
    ? "dedicated"
    : "bot token fallback";

  return [
    "📊 Bot Stats",
    "",
    `Global maintenance: ${maintenanceStatus}`,
    `Top-ups: ${topupStatus}`,
    `Runtime: ${runtimeMode}`,
    `Uptime: ${formatUptime(runtimeState.startedAt, now)}`,
    `Payment token secret: ${paymentSecret}`,
    "",
    `Saved users: ${userStats.total}`,
    `Active users (30d): ${userStats.active}`,
    "",
    `Low-balance alerts: ${alertStats.users} user(s), ${alertStats.meters} meter(s)`,
    `Alerts by system: ${formatStageCounts(alertStats.byHostel)}`,
    `Currently alerted (still low): ${alertStats.alerted}`,
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

// ── /broadcast / /announce ───────────────────────────────────────────────────
// Each bot only messages users with a saved meter on its own system. Telegram
// rejects messages to users who never started this bot, and a 403 forgets the
// user's meters, so sending to the other bot's users would wipe them.
async function sendToUsers(bot, chatIds, message, hostels) {
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
      // Only drop this bot's meters; the user may still use the other bot.
      if (err.response?.error_code === 403) forgetUser(chatId, hostels);
      failed++;
    }
    await new Promise((res) => setTimeout(res, 50));
  }

  return { sent, failed };
}

function registerBroadcast(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("broadcast", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/broadcast\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /broadcast <message>");

    const hostels = botOwnedHostels(config);
    const chatIds = getAllChatIds(hostels);
    if (!chatIds.length) return ctx.reply("No known users to broadcast to.");

    await ctx.reply(
      `📡 Broadcasting to ${chatIds.length} ${config.displayName} user(s)…`,
    );
    const { sent, failed } = await sendToUsers(bot, chatIds, message, hostels);

    track("broadcast_sent", {
      chatId: ctx.chat?.id,
      audience: config.audience,
      total: chatIds.length,
      sent,
      failed,
    });

    return ctx.reply(
      `✅ Broadcast complete. Sent: ${sent}, Failed: ${failed}.`,
    );
  });
}

function registerAnnounce(bot, runtime) {
  const { config } = runtimeParts(runtime);

  bot.command("announce", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/announce\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /announce <message>");

    const hostels = botOwnedHostels(config);
    const chatIds = getActiveChatIds(undefined, hostels); // last 30 days
    if (!chatIds.length)
      return ctx.reply("No active users in the last 30 days.");

    await ctx.reply(
      `📡 Announcing to ${chatIds.length} active ${config.displayName} user(s)…`,
    );
    const { sent, failed } = await sendToUsers(bot, chatIds, message, hostels);

    track("announce_sent", {
      chatId: ctx.chat?.id,
      audience: config.audience,
      total: chatIds.length,
      sent,
      failed,
    });

    return ctx.reply(`✅ Announce complete. Sent: ${sent}, Failed: ${failed}.`);
  });
}

// ── /maintenanceon / /maintenanceoff / /maintenancestatus ────────────────────
function registerMaintenanceToggle(bot) {
  bot.command("maintenanceon", async (ctx) => {
    if (!isOwner(ctx)) return;
    const status = setGlobalMaintenanceEnabled(true);
    track("global_maintenance_toggled", {
      chatId: ctx.chat?.id,
      enabled: true,
    });
    console.log("Global maintenance enabled by owner via /maintenanceon");
    return ctx.reply(
      `Maintenance mode is now ON. Users will see:\n\n${status.message}\n\nUse /maintenanceoff to re-enable the app and bot.`,
    );
  });

  bot.command("maintenanceoff", async (ctx) => {
    if (!isOwner(ctx)) return;
    setGlobalMaintenanceEnabled(false);
    track("global_maintenance_toggled", {
      chatId: ctx.chat?.id,
      enabled: false,
    });
    console.log("Global maintenance disabled by owner via /maintenanceoff");
    return ctx.reply("Maintenance mode is now OFF. The app and bot are live.");
  });

  bot.command("maintenancestatus", async (ctx) => {
    if (!isOwner(ctx)) return;
    const status = getGlobalMaintenanceStatus();
    return ctx.reply(
      status.enabled
        ? `Maintenance mode is ON. Users see:\n\n${status.message}`
        : "Maintenance mode is OFF. The app and bot are live.",
    );
  });
}

// ── /topupoff / /topupon / /topupstatus ───────────────────────────────────────
const fallbackState = {
  topupDisabled: process.env.TOPUP_DISABLED === "true",
  runtimeMode: null,
  startedAt: null,
};

function runtimeParts(runtime = {}) {
  return {
    state: runtime.state || fallbackState,
    config: runtime.config || DEFAULT_BOT_CONFIG,
    pendingReplies: runtime.pendingReplies || new Map(),
  };
}

function registerTopupToggle(bot, runtime) {
  const { state } = runtimeParts(runtime);

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

function registerStats(bot, runtime) {
  const { state, pendingReplies } = runtimeParts(runtime);

  bot.command("stats", async (ctx) => {
    if (!isOwner(ctx)) return;

    const userStats = getUserStats();
    const alertStats = getLowBalanceAlertStats();
    const sessionStats = getSessionStats();
    const submitLockStats = getPaymentSubmitLockStats();
    const message = buildOwnerStatsMessage({
      state,
      userStats,
      alertStats,
      sessionStats,
      pendingReplyCount: pendingReplies.size,
      submitLockStats,
    });

    track("owner_stats_requested", {
      chatId: ctx.chat?.id,
      savedUsers: userStats.total,
      activeUsers: userStats.active,
      alertUsers: alertStats.users,
    });

    return ctx.reply(message);
  });
}

function registerStatus(bot, runtime) {
  const { state } = runtimeParts(runtime);

  bot.command("status", async (ctx) => {
    if (!isOwner(ctx)) return;

    const loading = await ctx.reply("Checking service status...");
    const message = await buildOwnerStatus({ state });

    if (loading?.message_id && ctx.telegram?.editMessageText) {
      return ctx.telegram
        .editMessageText(ctx.chat.id, loading.message_id, undefined, message)
        .catch(() => ctx.reply(message));
    }

    return ctx.reply(message);
  });
}

// ── /resetdate ───────────────────────────────────────────────────────────────
// The days this bot's meters lose their credit. Each bot keeps its own dates,
// so NUS and SUTD can differ. Notes and reminders follow the next date to come.
const RESET_DATE_USAGE =
  "Usage: /resetdate YYYY-MM-DD [YYYY-MM-DD …] to set the days balances are forfeited (this replaces the saved dates), or /resetdate off to clear them.";

function describeDays(days) {
  if (days === 0) return "today";
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

function resetDateStatus(audience, store) {
  const upcoming = balanceReset
    .getResetDates(audience, store)
    .filter((date) => balanceReset.daysUntil(date) >= 0);
  if (!upcoming.length) {
    return "No upcoming reset dates, so reset notes and reminders are off.";
  }
  const lines = upcoming.map(
    (date, i) =>
      `${i === 0 ? "▶️" : "•"} ${date} (${describeDays(balanceReset.daysUntil(date))})`,
  );
  return `Reset dates:\n${lines.join("\n")}`;
}

async function handleResetDateCommand(ctx, config, store) {
  const args = String(ctx.message?.text || "")
    .trim()
    .split(/[\s,]+/)
    .slice(1)
    .filter(Boolean);

  if (!args.length) {
    return ctx.reply(
      `${resetDateStatus(config.audience, store)}\n\n${RESET_DATE_USAGE}`,
    );
  }

  if (args.length === 1 && args[0].toLowerCase() === "off") {
    balanceReset.setResetDates(config.audience, [], store);
    track("reset_date_changed", {
      chatId: ctx.chat?.id,
      audience: config.audience,
      dates: "",
    });
    return ctx.reply("Reset dates cleared. Reset notes and reminders are off.");
  }

  const invalid = args.filter((arg) => !balanceReset.parseResetDate(arg));
  if (invalid.length) {
    return ctx.reply(
      `Not a valid date: ${invalid.join(", ")}\n\n${RESET_DATE_USAGE}`,
    );
  }
  const past = args.filter((date) => balanceReset.daysUntil(date) < 0);
  if (past.length) {
    return ctx.reply(
      `Already past: ${past.join(", ")}. Only set dates that are still to come.`,
    );
  }

  balanceReset.setResetDates(config.audience, args, store);
  track("reset_date_changed", {
    chatId: ctx.chat?.id,
    audience: config.audience,
    dates: balanceReset.getResetDates(config.audience, store).join(","),
  });
  return ctx.reply(
    `${resetDateStatus(config.audience, store)}\n\n` +
      `${config.displayName} shows a note before top-ups from ${balanceReset.ADVICE_WINDOW_DAYS} days before the next date, ` +
      "and users with /alerts on get a reminder 14 and 3 days before it.",
  );
}

function registerResetDate(bot, runtime, store) {
  const { config } = runtimeParts(runtime);

  bot.command("resetdate", async (ctx) => {
    if (!isOwner(ctx)) return;
    return handleResetDateCommand(ctx, config, store);
  });
}

function registerOwnerCommands(bot, runtime) {
  registerBroadcast(bot, runtime);
  registerAnnounce(bot, runtime);
  registerMaintenanceToggle(bot);
  registerTopupToggle(bot, runtime);
  registerStats(bot, runtime);
  registerStatus(bot, runtime);
  registerResetDate(bot, runtime);
}

module.exports = {
  buildOwnerStatsMessage,
  formatStageCounts,
  formatUptime,
  handleResetDateCommand,
  registerOwnerCommands,
  isOwner,
};
