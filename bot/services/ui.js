const { DEFAULT_BOT_CONFIG } = require("../constants");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const GITHUB_URL = process.env.GITHUB_URL;

function helpText(config = DEFAULT_BOT_CONFIG) {
  if (config.audience === "sutd") {
    return (
      `ℹ️ *${config.displayName} Help*\n\n` +
      `*Supported SUTD tools*\n` +
      `• Online top-up\n` +
      `• Balance\n` +
      `• Top-up history\n\n` +
      `*Accepted SUTD top-up amount*\n` +
      `• Minimum: $10.00 SGD\n` +
      `• Maximum: $50.00 SGD\n\n` +
      `Usage history is not available for SUTD yet.\n\n` +
      `*Useful commands*\n` +
      `• /topup — start a new SUTD top-up\n` +
      `• /balance — check SUTD meter balance\n` +
      `• /topups — show SUTD top-up history\n` +
      `• /feedback — share feedback or report an issue\n` +
      `• /forget — clear your saved meters\n` +
      `• /cancel — cancel the current flow\n` +
      `• /help — show this message\n\n` +
      `*Terms of Use*\n` +
      `${SERVER_URL}/app/terms\n\n` +
      `Open source · ${GITHUB_URL}`
    );
  }

  return (
    `ℹ️ *${config.displayName} Help*\n\n` +
    `*Supported NUS systems*\n` +
    `• PGPR\n` +
    `• Houses @ PGP\n` +
    `• Residential Colleges\n` +
    `• NUS College\n` +
    `• UTown Residences\n` +
    `• RVRC\n` +
    `• Valour House\n` +
    `  → uses cp2nus.evs.com.sg\n` +
    `• Legacy CP2 fallback is available if your meter has not migrated\n\n` +
    `*Accepted NUS top-up amount*\n` +
    `• Minimum: $6.00 SGD\n` +
    `• Maximum: $50.00 SGD\n\n` +
    `*Useful commands*\n` +
    `• /topup — start a new top-up\n` +
    `• /balance — check meter balance\n` +
    `• /usage — show last 7 days of daily consumption,\n` +
    `  estimated days remaining, and current balance\n` +
    `• /topups — show recent top-ups from the last 90 days\n` +
    `• /feedback — share feedback or report an issue\n` +
    `• /forget — clear your saved meters\n` +
    `• /cancel — cancel the current flow\n` +
    `• /help — show this message\n\n` +
    `*Terms of Use*\n` +
    `${SERVER_URL}/app/terms\n\n` +
    `Open source · ${GITHUB_URL}`
  );
}

function shortDescription(config = DEFAULT_BOT_CONFIG) {
  if (config.audience === "sutd") {
    return "Check your SUTD EVS electricity balance and top up by card — right in Telegram.";
  }

  return "Check your hostel EVS electricity balance and top up by card — right in Telegram.";
}

function longDescription(config = DEFAULT_BOT_CONFIG) {
  if (config.audience === "sutd") {
    return (
      "Top up your SUTD EVS electricity meter by credit card, check your balance, " +
      "and view recent top-ups — all inside Telegram. Tap Start to begin."
    );
  }

  return (
    "Top up your NUS hostel EVS electricity meter by credit card, check your balance, " +
    "see 7-day usage, and view recent top-ups — all inside Telegram. Supports PGPR, " +
    "Houses @ PGP, Residential Colleges, NUS College, UTown Residences, RVRC, and " +
    "Valour House. Tap Start to begin."
  );
}

async function sendHelp(ctx, config = DEFAULT_BOT_CONFIG) {
  return ctx.replyWithMarkdown(helpText(config), config.mainKeyboard);
}

async function sendHelpForConfig(ctx, config = DEFAULT_BOT_CONFIG) {
  return ctx.replyWithMarkdown(helpText(config), config.mainKeyboard);
}

async function setupTelegramUi(bot, config = DEFAULT_BOT_CONFIG) {
  const lookupCommands =
    config.audience === "sutd"
      ? [
          { command: "balance", description: "Check SUTD meter balance" },
          { command: "topups", description: "Show SUTD top-ups" },
        ]
      : [
          { command: "balance", description: "Check meter balance" },
          { command: "usage", description: "Show recent daily usage" },
          { command: "topups", description: "Show recent top-ups" },
        ];

  await Promise.all([
    bot.telegram.setMyCommands([
      ...(config.supportsTopup
        ? [{ command: "topup", description: "Start electricity top-up" }]
        : []),
      ...lookupCommands,
      { command: "forget", description: "Clear saved meters" },
      { command: "feedback", description: "Share feedback or report an issue" },
      { command: "help", description: "Show help and usage" },
      { command: "cancel", description: "Cancel current flow" },
    ]),
    bot.telegram.setMyShortDescription(shortDescription(config)),
    bot.telegram.setMyDescription(longDescription(config)),
  ]);
}

module.exports = {
  helpText,
  shortDescription,
  longDescription,
  sendHelp,
  sendHelpForConfig,
  setupTelegramUi,
  SERVER_URL,
};
