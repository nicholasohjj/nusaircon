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

async function sendPaymentNotification(bot, session) {
  if (!session?.chatId || session.notifiedAt) return null;

  await bot.telegram.sendMessage(
    session.chatId,
    buildPaymentNotificationLines(session).join("\n"),
    {
      parse_mode: "Markdown",
    },
  );

  return Date.now();
}

module.exports = {
  buildPaymentNotificationLines,
  sendPaymentNotification,
};
