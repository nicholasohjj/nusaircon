require("dotenv").config();
if (!process.env.SERVER_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.SERVER_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
const { createHash } = require("crypto");
const { bot, pendingReplies } = require("./bot");
const { captureException, shutdownAnalytics } = require("../services/analytics");
const { PENDING_REPLY_TTL_MS } = require("./constants");
const { resetSession } = require("./services/session");
const { setupTelegramUi } = require("./services/ui");

// ── Register handlers (order matters — ownerReply before text) ────────────────
require("./commands/user").registerUserCommands(bot);
require("./commands/owner").registerOwnerCommands(bot);
require("./handlers/buttons").registerButtonHandlers(bot);
require("./handlers/actions").registerActionHandlers(bot);
require("./handlers/webAppData").registerWebAppDataHandler(bot);
require("./handlers/ownerReply").registerOwnerReplyHandler(bot);
require("./handlers/text").registerTextHandler(bot);

// ── Housekeeping: prune stale pending-reply entries ───────────────────────────
setInterval(
  () => {
    const now = Date.now();
    for (const [id, entry] of pendingReplies) {
      if (now - entry.createdAt > PENDING_REPLY_TTL_MS)
        pendingReplies.delete(id);
    }
  },
  60 * 60 * 1000,
).unref();

// ── Global error handler ──────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error("Telegram bot error", err);
  captureException(err, String(ctx?.chat?.id ?? "anonymous"));
  if (ctx?.chat?.id) {
    resetSession(ctx.chat.id);
    ctx
      .reply("⚠️ Something went wrong. Please try /topup again.")
      .catch(() => {});
  }
});

// ── Runtime mode ──────────────────────────────────────────────────────────────
const explicitMode = process.env.TELEGRAM_BOT_MODE?.trim().toLowerCase();
const serverUrl = (process.env.SERVER_URL || "").replace(/\/+$/, "");
const webhookPath = normalizeWebhookPath(process.env.TELEGRAM_WEBHOOK_PATH);
const webhookSecret =
  process.env.TELEGRAM_WEBHOOK_SECRET || defaultWebhookSecret();
let runtimeMode = null;
let started = false;

function defaultWebhookSecret() {
  return createHash("sha256")
    .update(process.env.TELEGRAM_BOT_TOKEN || "")
    .update(":evs-telegram-webhook")
    .digest("hex");
}

function normalizeWebhookPath(value) {
  if (!value) {
    const suffix = createHash("sha256")
      .update(process.env.TELEGRAM_BOT_TOKEN || "")
      .update(":evs-telegram-webhook-path")
      .digest("hex")
      .slice(0, 32);
    return `/telegram/webhook/${suffix}`;
  }

  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function shouldUseWebhook() {
  if (explicitMode === "webhook") return true;
  if (explicitMode === "polling") return false;
  if (explicitMode) {
    throw new Error(
      `Unsupported TELEGRAM_BOT_MODE "${process.env.TELEGRAM_BOT_MODE}". Use "webhook" or "polling".`,
    );
  }
  return process.env.NODE_ENV === "production";
}

function getWebhookUrl() {
  if (!serverUrl) {
    throw new Error(
      "SERVER_URL is required for Telegram webhook mode. On Railway, set SERVER_URL=https://${{RAILWAY_PUBLIC_DOMAIN}} or rely on RAILWAY_PUBLIC_DOMAIN.",
    );
  }

  if (!serverUrl.startsWith("https://")) {
    throw new Error(
      `Telegram webhook mode requires an HTTPS SERVER_URL, received: ${serverUrl}`,
    );
  }

  return `${serverUrl}${webhookPath}`;
}

function mountTelegramWebhook(app) {
  if (!shouldUseWebhook()) return;
  app.use(bot.webhookCallback(webhookPath, { secretToken: webhookSecret }));
}

function getBotRuntimeMode() {
  return runtimeMode || (shouldUseWebhook() ? "webhook" : "polling");
}

async function startBot() {
  if (started) return;
  await setupTelegramUi(bot);

  if (shouldUseWebhook()) {
    const webhookUrl = getWebhookUrl();
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: webhookSecret,
      drop_pending_updates: process.env.TELEGRAM_DROP_PENDING_UPDATES === "true",
    });
    runtimeMode = "webhook";
    started = true;
    console.log(`🤖 EVS Telegram bot listening via webhook at ${webhookPath}`);
    return;
  }

  await bot.telegram.deleteWebhook({ drop_pending_updates: true });

  // Retry up to 5 times — handles Railway deploy overlap where the old
  // instance hasn't fully released the long-poll connection yet.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      const { state } = require("./bot");
      runtimeMode = "polling";
      started = true;
      console.log(
        `🤖 EVS Telegram bot running via polling (top-ups ${state.topupDisabled ? "DISABLED" : "enabled"})`,
      );
      return;
    } catch (err) {
      if (err.response?.error_code === 409 && attempt < 5) {
        const delay = attempt * 3000;
        console.warn(
          `⚠️ 409 Conflict on attempt ${attempt}, retrying in ${delay / 1000}s…`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function stopBot(reason = "unspecified") {
  await shutdownAnalytics();
  if (runtimeMode !== "polling") return;
  bot.stop(reason);
}

module.exports = {
  bot,
  mountTelegramWebhook,
  startBot,
  stopBot,
  getBotRuntimeMode,
};
