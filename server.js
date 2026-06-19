require("dotenv").config();
if (!process.env.SERVER_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.SERVER_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
const path = require("path");
const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");
const { captureException } = require("./services/analytics");
const { buildRobotsTxt, buildSitemapXml } = require("./services/seo");
const {
  httpLogger,
  paymentBootstrapLimiter,
  paymentSubmitLimiter,
  securityHeaders,
} = require("./services/httpMiddleware");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const {
  mountTelegramWebhook,
  startBot,
  stopBot,
  getBotRuntimeMode,
} = require("./bot/index");

const openapiSpec = YAML.load(path.join(__dirname, "docs/openapi.yaml"));

function getPublicBaseUrl(req) {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

const app = express();
if (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(httpLogger);
app.use(securityHeaders);

mountTelegramWebhook(app);
app.use("/assets", express.static("assets"));

app.use("/app", express.static(path.join(__dirname, "frontend/dist")));

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(buildRobotsTxt(getPublicBaseUrl(req)));
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(buildSitemapXml(getPublicBaseUrl(req)));
});

app.get("/", (req, res) => {
  res.redirect(301, "/app/");
});

app.get(/^\/app\/.*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "frontend/dist/index.html"));
});

app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.get("/terms", (req, res) => {
  res.redirect("/app/terms");
});

if (process.env.NODE_ENV !== "production") {
  app.get("/debug", (req, res) => res.send("cp2nus prefix reachable"));
}
app.use("/api", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use("/webapp/bootstrap", paymentBootstrapLimiter);
app.use("/cp2nus/webapp/bootstrap", paymentBootstrapLimiter);
app.use("/webapp/enets_pay", paymentSubmitLimiter);
app.use("/cp2nus/webapp/enets_pay", paymentSubmitLimiter);

app.use("/cp2nus", cp2nus);
app.use("/", cp2);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  captureException(err, "anonymous", { path: req.path, method: req.method });
  res.status(500).send("Something went wrong.");
});

const port = process.env.PORT || 3000;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`App listening on port: ${port}`);
  startBot().catch((err) => {
    console.error("Failed to start Telegram bot:", err);
    server.close(() => process.exit(1));
  });
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await stopBot(signal);
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { app, server, getBotRuntimeMode };
