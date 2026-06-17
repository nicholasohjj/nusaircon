const { createHash, randomBytes } = require("crypto");

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const locks = new Map();

function getPaymentSubmitLockKey({ route, merchantTxnRef, token }) {
  const basis = JSON.stringify({
    route: String(route || ""),
    merchantTxnRef: String(merchantTxnRef || ""),
    token: String(merchantTxnRef ? "" : token || ""),
  });

  return createHash("sha256").update(basis).digest("hex");
}

function acquirePaymentSubmitLock(key, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return null;

  const now = Date.now();
  const existing = locks.get(key);
  if (existing && existing.expiresAt > now) return null;

  const lockId = randomBytes(16).toString("hex");
  locks.set(key, { lockId, expiresAt: now + ttlMs });

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const current = locks.get(key);
    if (current?.lockId === lockId) locks.delete(key);
  };
}

function clearPaymentSubmitLocks() {
  locks.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of locks.entries()) {
    if (entry.expiresAt <= now) locks.delete(key);
  }
}, DEFAULT_TTL_MS).unref();

module.exports = {
  DEFAULT_TTL_MS,
  acquirePaymentSubmitLock,
  clearPaymentSubmitLocks,
  getPaymentSubmitLockKey,
};
