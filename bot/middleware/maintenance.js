const { track } = require("../../services/analytics");
const {
  getGlobalMaintenanceStatus,
} = require("../../services/maintenanceMode");
const { DEFAULT_BOT_CONFIG } = require("../constants");
const { isOwner } = require("../commands/owner");
const { resetSession } = require("../services/session");

const MAINTENANCE_OWNER_COMMANDS = new Set([
  "maintenanceon",
  "maintenanceoff",
  "maintenancestatus",
  "status",
]);

function runtimeParts(runtime = {}) {
  return {
    config: runtime.config || DEFAULT_BOT_CONFIG,
  };
}

function getTextCommand(ctx) {
  const text = String(ctx.message?.text || "").trim();
  const match = text.match(/^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s|$)/);
  return match ? match[1].toLowerCase() : "";
}

function isAllowedMaintenanceCommand(ctx) {
  return isOwner(ctx) && MAINTENANCE_OWNER_COMMANDS.has(getTextCommand(ctx));
}

function createGlobalMaintenanceGuard(runtime = {}) {
  const { config } = runtimeParts(runtime);

  return async (ctx, next) => {
    const status = getGlobalMaintenanceStatus();
    if (!status.enabled || isAllowedMaintenanceCommand(ctx)) return next();

    const chatId = ctx.chat?.id;
    if (chatId) {
      resetSession(chatId, config.sessionKey);
      track("global_maintenance_bot_blocked", {
        chatId,
        updateType: ctx.updateType || "",
        command: getTextCommand(ctx),
      });
    }

    if (ctx.callbackQuery?.id) {
      await ctx
        .answerCbQuery("Service is temporarily unavailable.")
        .catch(() => {});
    }

    return ctx.reply(status.message, config.mainKeyboard);
  };
}

function registerGlobalMaintenanceGuard(bot, runtime) {
  bot.use(createGlobalMaintenanceGuard(runtime));
}

module.exports = {
  createGlobalMaintenanceGuard,
  getTextCommand,
  isAllowedMaintenanceCommand,
  registerGlobalMaintenanceGuard,
};
