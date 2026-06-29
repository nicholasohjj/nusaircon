const { getBotContext } = require("../bot/bot");
const { TOPUP_DISABLED_MESSAGE } = require("../bot/constants");
const { errorPage } = require("../views/errorPage");

function normalizeTopupAudience(audience = "nus") {
  return String(audience || "").trim().toLowerCase() === "sutd"
    ? "sutd"
    : "nus";
}

function getTopupAvailability(audience = "nus") {
  const requestedAudience = normalizeTopupAudience(audience);
  const context = getBotContext(requestedAudience);
  const disabled = Boolean(context.state.topupDisabled);

  return {
    audience: requestedAudience,
    botAudience: context.config.audience,
    enabled: !disabled,
    disabled,
    message: disabled ? TOPUP_DISABLED_MESSAGE : "",
  };
}

function getWebsiteTopupStatus() {
  return {
    nus: getTopupAvailability("nus"),
    sutd: getTopupAvailability("sutd"),
  };
}

function topupDisabledJson(audience = "nus") {
  const availability = getTopupAvailability(audience);
  return {
    ok: false,
    code: "TOPUP_DISABLED",
    audience: availability.audience,
    error: TOPUP_DISABLED_MESSAGE,
  };
}

function requireTopupEnabledJson(audience = "nus") {
  return (req, res, next) => {
    if (getTopupAvailability(audience).enabled) return next();
    return res.status(503).json(topupDisabledJson(audience));
  };
}

function requireTopupEnabledPage(audience = "nus") {
  return (req, res, next) => {
    if (getTopupAvailability(audience).enabled) return next();
    return res.status(503).send(errorPage(TOPUP_DISABLED_MESSAGE));
  };
}

module.exports = {
  getTopupAvailability,
  getWebsiteTopupStatus,
  normalizeTopupAudience,
  requireTopupEnabledJson,
  requireTopupEnabledPage,
  topupDisabledJson,
};
