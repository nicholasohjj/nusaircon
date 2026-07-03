require("dotenv").config();
if (!process.env.SERVER_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.SERVER_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
const { createHash } = require("crypto");
const { bot, botContexts } = require("./bot");
const { captureException, shutdownAnalytics } = require("../services/analytics");
const { PENDING_REPLY_TTL_MS } = require("./constants");
const { shouldUseWebhook } = require("./runtimeMode");
const { resetSession } = require("./services/session");
const { setupTelegramUi } = require("./services/ui");

function registerHandlers(context) {
  const telegramBot = context.bot;

  // Order matters: maintenance guard first; ownerReply before generic text.
  require("./middleware/maintenance").registerGlobalMaintenanceGuard(
    telegramBot,
    context,
  );
  require("./commands/user").registerUserCommands(telegramBot, context);
  require("./commands/owner").registerOwnerCommands(telegramBot, context);
  require("./handlers/buttons").registerButtonHandlers(telegramBot, context);
  require("./handlers/actions").registerActionHandlers(telegramBot, context);
  require("./handlers/webAppData").registerWebAppDataHandler(
    telegramBot,
    context,
  );
  require("./handlers/ownerReply").registerOwnerReplyHandler(
    telegramBot,
    context,
  );
  require("./handlers/text").registerTextHandler(telegramBot, context);

  telegramBot.catch((err, ctx) => {
    console.error(`${context.config.displayName} error`, err);
    captureException(err, String(ctx?.chat?.id ?? "anonymous"), {
      botAudience: context.config.audience,
    });
    if (ctx?.chat?.id) {
      resetSession(ctx.chat.id, context.config.sessionKey);
      ctx
        .reply(
          context.config.supportsTopup
            ? "⚠️ Something went wrong. Please try /topup again."
            : "⚠️ Something went wrong. Please try /balance or /topups again.",
        )
        .catch(() => {});
    }
  });
}

for (const context of botContexts) registerHandlers(context);

// ── Housekeeping: prune stale pending-reply entries ───────────────────────────
setInterval(
  () => {
    const now = Date.now();
    for (const context of botContexts) {
      for (const [id, entry] of context.pendingReplies) {
        if (now - entry.createdAt > PENDING_REPLY_TTL_MS) {
          context.pendingReplies.delete(id);
        }
      }
    }
  },
  60 * 60 * 1000,
).unref();

// ── Runtime mode ──────────────────────────────────────────────────────────────
const serverUrl = (process.env.SERVER_URL || "").replace(/\/+$/, "");
let runtimeMode = null;
let started = false;

function envFor(context, key) {
  const scoped = process.env[`${context.envPrefix}_${key}`];
  if (scoped) return scoped;
  return botContexts.length === 1 ? process.env[key] : undefined;
}

function defaultWebhookSecret(context) {
  return createHash("sha256")
    .update(context.token)
    .update(":evs-telegram-webhook")
    .digest("hex");
}

function normalizeWebhookPath(value, context) {
  if (!value) {
    const suffix = createHash("sha256")
      .update(context.token)
      .update(":evs-telegram-webhook-path")
      .digest("hex")
      .slice(0, 32);
    return `/telegram/webhook/${context.key}/${suffix}`;
  }

  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function getWebhookPath(context) {
  return normalizeWebhookPath(envFor(context, "TELEGRAM_WEBHOOK_PATH"), context);
}

function getWebhookSecret(context) {
  return envFor(context, "TELEGRAM_WEBHOOK_SECRET") || defaultWebhookSecret(context);
}

function getWebhookUrl(context) {
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

  return `${serverUrl}${getWebhookPath(context)}`;
}

function mountTelegramWebhook(app) {
  if (!shouldUseWebhook()) return;
  for (const context of botContexts) {
    app.use(
      context.bot.webhookCallback(getWebhookPath(context), {
        secretToken: getWebhookSecret(context),
      }),
    );
  }
}

function getBotRuntimeMode() {
  return runtimeMode || (shouldUseWebhook() ? "webhook" : "polling");
}

async function startBot() {
  if (started) return;
  await Promise.all(
    botContexts.map((context) => setupTelegramUi(context.bot, context.config)),
  );

  if (shouldUseWebhook()) {
    for (const context of botContexts) {
      const webhookUrl = getWebhookUrl(context);
      await context.bot.telegram.setWebhook(webhookUrl, {
        secret_token: getWebhookSecret(context),
        drop_pending_updates:
          process.env.TELEGRAM_DROP_PENDING_UPDATES === "true",
      });
      context.state.runtimeMode = "webhook";
      context.state.startedAt = Date.now();
      console.log(
        `🤖 ${context.config.displayName} listening via webhook at ${getWebhookPath(context)}`,
      );
    }
    runtimeMode = "webhook";
    started = true;
    return;
  }

  await Promise.all(
    botContexts.map((context) =>
      context.bot.telegram.deleteWebhook({ drop_pending_updates: true }),
    ),
  );

  // Retry up to 5 times — handles Railway deploy overlap where the old
  // instance hasn't fully released the long-poll connection yet.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await Promise.all(
        botContexts.map((context) =>
          context.bot.launch({ dropPendingUpdates: true }).then(() => {
            context.state.runtimeMode = "polling";
            context.state.startedAt = Date.now();
          }),
        ),
      );
      runtimeMode = "polling";
      started = true;
      for (const context of botContexts) {
        console.log(
          `🤖 ${context.config.displayName} running via polling (top-ups ${context.state.topupDisabled ? "DISABLED" : "enabled"})`,
        );
      }
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
  for (const context of botContexts) context.bot.stop(reason);
}

module.exports = {
  bot,
  mountTelegramWebhook,
  startBot,
  stopBot,
  getBotRuntimeMode,
};
