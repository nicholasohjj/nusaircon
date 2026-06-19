function getExplicitBotMode() {
  return process.env.TELEGRAM_BOT_MODE?.trim().toLowerCase();
}

function shouldUseWebhook() {
  const explicitMode = getExplicitBotMode();

  if (explicitMode === "webhook") return true;
  if (explicitMode === "polling") return false;
  if (explicitMode) {
    throw new Error(
      `Unsupported TELEGRAM_BOT_MODE "${process.env.TELEGRAM_BOT_MODE}". Use "webhook" or "polling".`,
    );
  }

  return (
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN?.trim()) ||
    process.env.NODE_ENV === "production"
  );
}

function inferRuntimeMode() {
  return shouldUseWebhook() ? "webhook" : "polling";
}

module.exports = {
  inferRuntimeMode,
  shouldUseWebhook,
};
