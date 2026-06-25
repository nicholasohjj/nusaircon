const { SESSION_TTL_MS } = require("../constants");

// ── In-memory session store ───────────────────────────────────────────────────
// sessionKey:chatId → { stage, hostel?, txtMtrId?, amountDollars?, amountCents?,
//                             webAppUrl?, feedbackRating?, updatedAt }
const sessions = {};

function sessionId(chatId, namespace = "default") {
  return `${namespace}:${chatId}`;
}

function pruneExpiredSessions(now = Date.now()) {
  for (const chatId of Object.keys(sessions)) {
    if (now - (sessions[chatId].updatedAt ?? 0) > SESSION_TTL_MS) {
      delete sessions[chatId];
    }
  }
}

// Prune expired sessions every SESSION_TTL_MS
setInterval(() => {
  const now = Date.now();
  pruneExpiredSessions(now);
}, SESSION_TTL_MS).unref();

/**
 * Returns the live session object for chatId, creating/resetting it if
 * it doesn't exist or has expired. Always touches updatedAt.
 */
function getSession(chatId, namespace = "default") {
  const now = Date.now();
  const key = sessionId(chatId, namespace);
  const s = sessions[key];

  if (!s || now - (s.updatedAt ?? 0) > SESSION_TTL_MS) {
    sessions[key] = { stage: "idle", updatedAt: now };
  } else {
    sessions[key].updatedAt = now;
  }

  return sessions[key];
}

/** Hard-reset a session to idle, discarding all pending state. */
function resetSession(chatId, namespace = "default") {
  sessions[sessionId(chatId, namespace)] = { stage: "idle", updatedAt: Date.now() };
}

function getSessionStats() {
  pruneExpiredSessions();

  const byStage = {};
  for (const session of Object.values(sessions)) {
    const stage = session.stage || "unknown";
    byStage[stage] = (byStage[stage] || 0) + 1;
  }

  return {
    total: Object.keys(sessions).length,
    byStage,
    lockedChats: chatLocks.size,
    queuedHandlers: [...chatWaiters.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
  };
}

// ── Per-chat concurrency lock ─────────────────────────────────────────────────
// Ensures only one handler runs at a time per chat, queuing the rest.
const chatLocks = new Map();
const chatWaiters = new Map(); // chatId → number of active + queued handlers

async function withChatLock(chatId, fn, namespace = "default") {
  const key = sessionId(chatId, namespace);
  chatWaiters.set(key, (chatWaiters.get(key) ?? 0) + 1);

  const prev = chatLocks.get(key) ?? Promise.resolve();
  let release;
  const next = new Promise((res) => (release = res));
  chatLocks.set(
    key,
    prev.then(() => next),
  );

  try {
    await prev;
    return await fn();
  } finally {
    release();

    const remaining = (chatWaiters.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      chatWaiters.delete(key);
      chatLocks.delete(key);
    } else {
      chatWaiters.set(key, remaining);
    }
  }
}

module.exports = { getSession, resetSession, withChatLock, getSessionStats };
