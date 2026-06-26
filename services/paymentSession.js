const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require("crypto");

const TOKEN_VERSION = "ps1";
const TTL_MS = 10 * 60 * 1000; // pending payment sessions: 10 minutes
const RESULT_TTL_MS = 24 * 60 * 60 * 1000; // completed result pages: 24 hours

const bootSecret = randomBytes(32).toString("hex");
const receiptStore = new Map();
let warnedAboutVolatileSecret = false;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase64url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function getSecret() {
  const secret =
    process.env.PAYMENT_SESSION_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.NUS_TELEGRAM_BOT_TOKEN ||
    process.env.SUTD_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN_NUS ||
    process.env.TELEGRAM_BOT_TOKEN_SUTD;

  if (secret) return String(secret);

  if (!warnedAboutVolatileSecret) {
    warnedAboutVolatileSecret = true;
    console.warn(
      "PAYMENT_SESSION_SECRET is not set; payment tokens will not survive restarts.",
    );
  }

  return bootSecret;
}

function getKey() {
  return createHash("sha256").update(getSecret()).digest();
}

function seal(data, ttlMs) {
  const now = Date.now();
  const payload = {
    ...data,
    createdAt: data.createdAt || now,
    expiresAt: now + ttlMs,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, base64url(iv), base64url(ciphertext), base64url(tag)]
    .join(".");
}

function unseal(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;

  try {
    const [, encodedIv, encodedCiphertext, encodedTag] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      fromBase64url(encodedIv),
    );
    decipher.setAuthTag(fromBase64url(encodedTag));
    const plaintext = Buffer.concat([
      decipher.update(fromBase64url(encodedCiphertext)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext);

    if (!payload || Date.now() > Number(payload.expiresAt || 0)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createPaymentSession(data) {
  return seal(
    {
      ...data,
      tokenKind: "payment",
    },
    TTL_MS,
  );
}

function createPaymentResultSession(session, updates = {}) {
  return seal(
    {
      tokenKind: "result",
      txtMtrId: session.txtMtrId || "",
      txtAmount: session.txtAmount || "",
      chatId: session.chatId || null,
      address: session.address || "",
      balance: session.balance ?? "",
      status: updates.status || session.status || "unknown",
      reason: updates.reason ?? session.reason ?? "",
      merchantTxnRef:
        updates.merchantTxnRef ?? session.merchantTxnRef ?? "",
      source: updates.source ?? session.source ?? "",
      completedAt: updates.completedAt || session.completedAt || Date.now(),
      notifiedAt: updates.notifiedAt || session.notifiedAt || null,
      receiptId: updates.receiptId || session.receiptId || null,
    },
    RESULT_TTL_MS,
  );
}

function consumePaymentSession(token) {
  return getPaymentSession(token);
}

function getPaymentSession(token, expectedKind = null) {
  const session = unseal(token);
  if (!session) return null;
  if (
    expectedKind &&
    session.tokenKind &&
    session.tokenKind !== expectedKind
  ) {
    return null;
  }
  return session;
}

function storeReceiptPdf(receiptPdf) {
  if (!receiptPdf) return null;

  const receiptId = randomBytes(16).toString("hex");
  receiptStore.set(receiptId, {
    receiptPdf: Buffer.from(receiptPdf),
    expiresAt: Date.now() + RESULT_TTL_MS,
  });
  return receiptId;
}

function getReceiptPdf(token) {
  const session = getPaymentSession(token, "result");
  const receiptId = session?.receiptId;
  if (!receiptId) return null;

  const entry = receiptStore.get(receiptId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    receiptStore.delete(receiptId);
    return null;
  }

  return entry.receiptPdf;
}

setInterval(() => {
  const now = Date.now();
  for (const [receiptId, entry] of receiptStore.entries()) {
    if (now > entry.expiresAt) receiptStore.delete(receiptId);
  }
}, TTL_MS).unref();

module.exports = {
  TTL_MS,
  RESULT_TTL_MS,
  createPaymentSession,
  createPaymentResultSession,
  consumePaymentSession,
  getPaymentSession,
  storeReceiptPdf,
  getReceiptPdf,
};
