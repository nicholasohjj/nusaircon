const { errorPage } = require("../views/errorPage");

const DEFAULT_MAINTENANCE_MESSAGE =
  "The service is temporarily unavailable while maintenance is in progress. Please try again later.";

function parseBoolean(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

const maintenanceState = {
  enabled: parseBoolean(
    process.env.MAINTENANCE_MODE ?? process.env.GLOBAL_MAINTENANCE,
  ),
};

function getMaintenanceMessage() {
  return (
    String(process.env.MAINTENANCE_MESSAGE || "").trim() ||
    DEFAULT_MAINTENANCE_MESSAGE
  );
}

function getGlobalMaintenanceStatus() {
  return {
    enabled: Boolean(maintenanceState.enabled),
    message: maintenanceState.enabled ? getMaintenanceMessage() : "",
  };
}

function setGlobalMaintenanceEnabled(enabled) {
  maintenanceState.enabled = Boolean(enabled);
  return getGlobalMaintenanceStatus();
}

function globalMaintenanceJson() {
  return {
    ok: false,
    code: "MAINTENANCE_MODE",
    error: getMaintenanceMessage(),
  };
}

function shouldSendJson(req) {
  if (
    req.path.startsWith("/website") ||
    req.path.startsWith("/api") ||
    req.path.endsWith("/bootstrap") ||
    req.path.endsWith("/enets_pay")
  ) {
    return true;
  }

  const accept = String(req.get("accept") || "");
  return accept.includes("application/json") && !accept.includes("text/html");
}

function normalizeAllowPaths(allowPaths = []) {
  return new Set(Array.from(allowPaths, (path) => String(path || "")));
}

function requireGlobalMaintenanceOff({ allowPaths = ["/health"] } = {}) {
  const allowed = normalizeAllowPaths(allowPaths);

  return (req, res, next) => {
    if (!maintenanceState.enabled || allowed.has(req.path)) return next();

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });

    if (shouldSendJson(req)) {
      return res.status(503).json(globalMaintenanceJson());
    }

    return res.status(503).send(errorPage(getMaintenanceMessage()));
  };
}

module.exports = {
  DEFAULT_MAINTENANCE_MESSAGE,
  getGlobalMaintenanceStatus,
  globalMaintenanceJson,
  requireGlobalMaintenanceOff,
  setGlobalMaintenanceEnabled,
};
