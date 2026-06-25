require("dotenv").config();
const { Telegraf } = require("telegraf");
const { createBotConfig, normalizeBotAudience } = require("./constants");

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function createBotContext({ key, token, audience, envPrefix }) {
  const config = createBotConfig(audience);
  const topupDisabled =
    process.env[`${envPrefix}_TOPUP_DISABLED`] ??
    process.env.TOPUP_DISABLED ??
    "false";

  return {
    key,
    token,
    envPrefix,
    bot: new Telegraf(token),
    config,
    // Exported as an object so mutations are visible to all importers.
    state: {
      topupDisabled: String(topupDisabled).trim().toLowerCase() === "true",
      runtimeMode: null,
      startedAt: null,
    },
    // pendingReplies: messageId -> { chatId, ownerMsgId, createdAt }
    pendingReplies: new Map(),
  };
}

function buildBotContexts() {
  const legacyToken = firstEnv("TELEGRAM_BOT_TOKEN");
  const legacyAudience = normalizeBotAudience(process.env.TELEGRAM_BOT_AUDIENCE);
  const nusToken =
    firstEnv("NUS_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN_NUS") ||
    (legacyAudience === "nus" ? legacyToken : "");
  const sutdToken =
    firstEnv("SUTD_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN_SUTD") ||
    (legacyAudience === "sutd" ? legacyToken : "");

  const contexts = [];
  if (nusToken) {
    contexts.push(
      createBotContext({
        key: "nus",
        token: nusToken,
        audience: "nus",
        envPrefix: "NUS",
      }),
    );
  }

  if (sutdToken && sutdToken !== nusToken) {
    contexts.push(
      createBotContext({
        key: "sutd",
        token: sutdToken,
        audience: "sutd",
        envPrefix: "SUTD",
      }),
    );
  }

  if (!contexts.length) {
    throw new Error(
      "Set TELEGRAM_BOT_TOKEN, NUS_TELEGRAM_BOT_TOKEN, or SUTD_TELEGRAM_BOT_TOKEN.",
    );
  }

  return contexts;
}

const botContexts = buildBotContexts();
const defaultContext = botContexts[0];

function getBotContext(audience = "nus") {
  const normalized = normalizeBotAudience(audience);
  return (
    botContexts.find((context) => context.config.audience === normalized) ||
    defaultContext
  );
}

function getPaymentBot(audience = "nus") {
  return getBotContext(audience).bot;
}

module.exports = {
  bot: defaultContext.bot,
  state: defaultContext.state,
  pendingReplies: defaultContext.pendingReplies,
  config: defaultContext.config,
  botContexts,
  getBotContext,
  getPaymentBot,
};
