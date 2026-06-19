const helmet = require("helmet");
const pinoHttp = require("pino-http");
const { rateLimit } = require("express-rate-limit");

const SENSITIVE_QUERY_KEYS = new Set([
  "enc",
  "hmac",
  "message",
  "restartUrl",
  "token",
]);

function sanitizeRequestUrl(rawUrl = "") {
  try {
    const url = new URL(String(rawUrl), "http://local");
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return String(rawUrl || "");
  }
}

function isProductionLike() {
  return (
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    process.env.NODE_ENV === "production"
  );
}

const appSecurityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: [
        "'self'",
        "https://web.telegram.org",
        "https://*.telegram.org",
      ],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: isProductionLike() ? [] : null,
    },
  },
  xFrameOptions: false,
});

// Swagger UI uses inline bootstrapping scripts, so keep CSP off for docs while
// retaining the rest of Helmet's headers.
const docsSecurityHeaders = helmet({ contentSecurityPolicy: false });

function securityHeaders(req, res, next) {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return docsSecurityHeaders(req, res, next);
  }

  return appSecurityHeaders(req, res, next);
}

const httpLogger = pinoHttp({
  level: process.env.LOG_LEVEL || (isProductionLike() ? "info" : "warn"),
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ],
    censor: "[redacted]",
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: sanitizeRequestUrl(req.url),
        remoteAddress: req.remoteAddress,
        userAgent: req.headers["user-agent"],
      };
    },
  },
});

function createJsonRateLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      ok: false,
      code: "RATE_LIMITED",
      error: message,
    },
  });
}

const paymentBootstrapLimiter = createJsonRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: "Too many payment starts. Please wait a few minutes and try again.",
});

const paymentSubmitLimiter = createJsonRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  message: "Too many payment submissions. Please wait before trying again.",
});

module.exports = {
  createJsonRateLimiter,
  httpLogger,
  paymentBootstrapLimiter,
  paymentSubmitLimiter,
  sanitizeRequestUrl,
  securityHeaders,
};
