function buildPaymentNotificationLines(session) {
  const {
    status,
    merchantTxnRef,
    txtMtrId,
    txtAmount,
    reason,
    address,
    balance,
  } = session;
  const ok = status === "success";
  const lines = [
    ok ? "✅ *Top-Up Successful*" : "⚠️ *Top-Up Failed*",
    "",
    `🔌 Meter ID: \`${txtMtrId || "-"}\``,
  ];

  if (address) lines.push(`🏠 Address: ${address}`);
  if (txtAmount) lines.push(`💵 Amount: SGD ${Number(txtAmount).toFixed(2)}`);
  if (balance !== "" && balance != null)
    lines.push(`💰 Balance before top-up: SGD ${Number(balance).toFixed(2)}`);
  if (merchantTxnRef) lines.push(`🧾 Reference: \`${merchantTxnRef}\``);
  if (!ok && reason) lines.push(`\n❌ Reason: ${reason}`);

  return lines;
}

// Result tokens are stateless, so a send that happens after the token was
// minted can't be recorded in it. This map stops repeat /webapp/notify calls
// with the same token from re-sending the message.
const NOTIFY_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000; // matches the result-token TTL
const sentNotifications = new Map(); // dedupe key -> expiresAt

function notificationDedupeKey(session) {
  return [
    session.chatId,
    session.status || "",
    session.merchantTxnRef || "",
    session.completedAt || "",
  ].join(":");
}

async function sendPaymentNotification(bot, session) {
  if (!session?.chatId || session.notifiedAt) return null;

  const key = notificationDedupeKey(session);
  const expiresAt = sentNotifications.get(key);
  if (expiresAt && Date.now() < expiresAt) return null;
  // Marked before sending so concurrent calls can't both send; a failed send
  // unmarks, so the page's retry still works.
  sentNotifications.set(key, Date.now() + NOTIFY_DEDUPE_TTL_MS);

  try {
    await bot.telegram.sendMessage(
      session.chatId,
      buildPaymentNotificationLines(session).join("\n"),
      {
        parse_mode: "Markdown",
      },
    );
  } catch (err) {
    sentNotifications.delete(key);
    throw err;
  }

  return Date.now();
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, expiresAt] of sentNotifications.entries()) {
      if (now > expiresAt) sentNotifications.delete(key);
    }
  },
  60 * 60 * 1000,
).unref();

module.exports = {
  buildPaymentNotificationLines,
  sendPaymentNotification,
};
