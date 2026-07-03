const DEFAULT_PAYMENT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_PAYMENT_FAILURE_EVENTS = 500;
const paymentFailures = [];

function prunePaymentFailures(now = Date.now()) {
  const oldestToKeep = now - DEFAULT_PAYMENT_FAILURE_WINDOW_MS;
  while (
    paymentFailures.length &&
    paymentFailures[0].timestamp < oldestToKeep
  ) {
    paymentFailures.shift();
  }

  while (paymentFailures.length > MAX_PAYMENT_FAILURE_EVENTS) {
    paymentFailures.shift();
  }
}

function recordPaymentFailure(data = {}, now = Date.now()) {
  paymentFailures.push({
    timestamp: now,
    route: data.route || "",
    source: data.source || "",
    status: data.status || "",
    reason: data.reason || "",
    merchantTxnRef: data.merchantTxnRef || "",
  });
  prunePaymentFailures(now);
}

function getRecentPaymentFailureStats({
  windowMs = DEFAULT_PAYMENT_FAILURE_WINDOW_MS,
  now = Date.now(),
} = {}) {
  prunePaymentFailures(now);
  const since = now - windowMs;
  const recent = paymentFailures.filter((event) => event.timestamp >= since);

  return {
    count: recent.length,
    windowMs,
  };
}

function clearPaymentMetrics() {
  paymentFailures.length = 0;
}

module.exports = {
  DEFAULT_PAYMENT_FAILURE_WINDOW_MS,
  clearPaymentMetrics,
  getRecentPaymentFailureStats,
  recordPaymentFailure,
};
