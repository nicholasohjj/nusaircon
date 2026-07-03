const axios = require("axios");
const { DEFAULT_HEADERS, CP2_WEBPOS_BASE } = require("../../services/config");
const { getGlobalMaintenanceStatus } = require("../../services/maintenanceMode");
const { getPaymentSubmitLockStats } = require("../../services/paymentSubmitLock");
const {
  getRecentPaymentFailureStats,
} = require("../../services/paymentMetrics");
const { inferRuntimeMode } = require("../runtimeMode");
const { getUserStats } = require("./userStore");

const DEFAULT_STATUS_TIMEOUT_MS = 4000;
const ENETS_HEALTH_URL = "https://www2.enets.sg/GW2/pluginpages/env.jsp";
const EVS_HEALTH_URL = `${CP2_WEBPOS_BASE}/EVSWebPOS/`;

function statusTimeoutMs() {
  const configured = Number(process.env.OWNER_STATUS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_STATUS_TIMEOUT_MS;
}

function formatWindow(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function formatCheck(check) {
  if (!check) return "unknown";

  const latency = Number.isFinite(check.latencyMs)
    ? `, ${check.latencyMs}ms`
    : "";

  if (check.ok) {
    return check.status ? `OK (HTTP ${check.status}${latency})` : "OK";
  }

  if (check.status) {
    return `DOWN (HTTP ${check.status}${latency})`;
  }

  return `DOWN (${check.error || "unreachable"}${latency})`;
}

async function checkDbHealth({ getStats = getUserStats } = {}) {
  try {
    const stats = getStats();
    return {
      ok: true,
      totalUsers: stats.total,
      activeUsers: stats.active,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

async function checkHttpReachability(
  name,
  url,
  { httpClient = axios, timeoutMs = statusTimeoutMs(), now = Date.now } = {},
) {
  const startedAt = now();

  try {
    const resp = await httpClient.get(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxContentLength: 64 * 1024,
      maxRedirects: 3,
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    const status = Number(resp.status);
    return {
      name,
      ok: status > 0 && status < 500,
      status,
      latencyMs: Math.max(0, now() - startedAt),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: err.response?.status || null,
      latencyMs: Math.max(0, now() - startedAt),
      error: err.code || err.message || "request_failed",
    };
  }
}

async function checkUpstreamReachability(options = {}) {
  const [evs, enets] = await Promise.all([
    checkHttpReachability("EVS", EVS_HEALTH_URL, options),
    checkHttpReachability("eNETS", ENETS_HEALTH_URL, options),
  ]);

  return { evs, enets };
}

function buildOwnerStatusMessage({
  state = {},
  maintenanceStatus = getGlobalMaintenanceStatus(),
  runtimeMode = state.runtimeMode || inferRuntimeMode(),
  db,
  evs,
  enets,
  paymentFailures = getRecentPaymentFailureStats(),
  submitLockStats = getPaymentSubmitLockStats(),
} = {}) {
  const maintenance = maintenanceStatus.enabled ? "ON" : "OFF";
  const topups = state.topupDisabled ? "disabled" : "enabled";
  const dbText = db?.ok
    ? `OK (${db.totalUsers ?? 0} saved, ${db.activeUsers ?? 0} active)`
    : `DOWN (${db?.error || "unavailable"})`;

  return [
    "Service Status",
    "",
    `Maintenance mode: ${maintenance}`,
    `Top-up mode: ${topups}`,
    `Bot runtime: ${runtimeMode}`,
    `DB: ${dbText}`,
    `EVS reachable: ${formatCheck(evs)}`,
    `eNETS reachable: ${formatCheck(enets)}`,
    `Payment failures (${formatWindow(paymentFailures.windowMs)}): ${paymentFailures.count}`,
    `Active payment submit locks: ${submitLockStats.active}`,
  ].join("\n");
}

async function buildOwnerStatus({
  state = {},
  httpClient = axios,
  timeoutMs = statusTimeoutMs(),
  dbHealthCheck = checkDbHealth,
  upstreamReachabilityCheck = checkUpstreamReachability,
  paymentFailureStats = getRecentPaymentFailureStats,
  submitLockStats = getPaymentSubmitLockStats,
} = {}) {
  const [db, upstreams] = await Promise.all([
    dbHealthCheck(),
    upstreamReachabilityCheck({ httpClient, timeoutMs }),
  ]);

  return buildOwnerStatusMessage({
    state,
    db,
    evs: upstreams.evs,
    enets: upstreams.enets,
    paymentFailures: paymentFailureStats(),
    submitLockStats: submitLockStats(),
  });
}

module.exports = {
  DEFAULT_STATUS_TIMEOUT_MS,
  ENETS_HEALTH_URL,
  EVS_HEALTH_URL,
  buildOwnerStatus,
  buildOwnerStatusMessage,
  checkDbHealth,
  checkHttpReachability,
  checkUpstreamReachability,
  formatCheck,
  formatWindow,
};
