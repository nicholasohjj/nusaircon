require("dotenv").config();
if (!process.env.SERVER_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.SERVER_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
const path = require("path");
const fs = require("fs");
const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");
const sutd = require("./routes/sutd");
const { router: websiteRoutes } = require("./routes/website");
const { captureException, shutdownAnalytics } = require("./services/analytics");
const {
  buildGoogleVerificationFileContent,
  buildRobotsTxt,
  buildSitemapXml,
  injectSeoHead,
  normalizeGoogleVerificationFileName,
  shouldSendNoindexHeader,
} = require("./services/seo");
const {
  httpLogger,
  paymentBootstrapLimiter,
  paymentSubmitLimiter,
  securityHeaders,
} = require("./services/httpMiddleware");
const {
  getWebsiteTopupStatus,
  requireTopupEnabledJson,
  requireTopupEnabledPage,
} = require("./services/topupAvailability");
const { requireGlobalMaintenanceOff } = require("./services/maintenanceMode");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const {
  mountTelegramWebhook,
  startBot,
  stopBot,
  getBotRuntimeMode,
} = require("./bot/index");

const openapiSpec = YAML.load(path.join(__dirname, "docs/openapi.yaml"));
const openapiJsonPath = "/api/openapi.json";
const swaggerUiOptions = {
  customSiteTitle: "EVS Meter Tools API",
  swaggerOptions: {
    url: openapiJsonPath,
    validatorUrl: null,
  },
};

function setNoStoreHeaders(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

function buildSwaggerInitScript(specUrl = openapiJsonPath) {
  return `window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout",
    validatorUrl: null
  });
};
`;
}

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
app.use((req, res, next) => {
  if (shouldSendNoindexHeader(req.path)) {
    res.set("X-Robots-Tag", "noindex, nofollow");
  }
  next();
});

mountTelegramWebhook(app);
app.use(requireGlobalMaintenanceOff());
app.use("/assets", express.static("assets"));

const appDistDir = path.join(__dirname, "frontend/dist");
const appIndexPath = path.join(appDistDir, "index.html");

app.use("/app", express.static(appDistDir, { index: false }));

function sendAppIndex(req, res, next) {
  fs.readFile(appIndexPath, "utf8", (err, html) => {
    if (err) return next(err);

    const runtimeConfigScript = `<script>window.__EVS_RUNTIME_CONFIG__=${JSON.stringify({
      topup: getWebsiteTopupStatus(),
    }).replace(/</g, "\\u003c")};</script>`;
    const htmlWithRuntimeConfig = html.replace(
      "</head>",
      `${runtimeConfigScript}</head>`,
    );

    res
      .type("html")
      .send(
        injectSeoHead(htmlWithRuntimeConfig, req.path, getPublicBaseUrl(req)),
      );
  });
}

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(buildRobotsTxt(getPublicBaseUrl(req)));
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(buildSitemapXml(getPublicBaseUrl(req)));
});

const googleVerificationFileName = normalizeGoogleVerificationFileName(
  process.env.GOOGLE_SITE_VERIFICATION_FILE,
);

if (googleVerificationFileName) {
  app.get(`/${googleVerificationFileName}`, (req, res) => {
    res
      .type("text/html")
      .send(
        buildGoogleVerificationFileContent(
          googleVerificationFileName,
          process.env.GOOGLE_SITE_VERIFICATION_CONTENT || "",
        ),
      );
  });
} else if (process.env.GOOGLE_SITE_VERIFICATION_FILE) {
  console.warn("Ignoring invalid GOOGLE_SITE_VERIFICATION_FILE value.");
}

app.get("/", (req, res) => {
  res.redirect(301, "/app/");
});

app.get(/^\/app$/, (req, res) => {
  res.redirect(301, "/app/");
});

app.get(/^\/app\/(?:loading|pay)\/?$/, requireTopupEnabledPage("nus"));
app.get(
  /^\/app\/cp2nus\/(?:loading|pay)\/?$/,
  requireTopupEnabledPage("nus"),
);
app.get(/^\/app\/sutd\/(?:loading|pay)\/?$/, requireTopupEnabledPage("sutd"));

app.get(/^\/app\/.*$/, sendAppIndex);

app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.get("/terms", (req, res) => {
  res.redirect("/app/terms");
});

if (process.env.NODE_ENV !== "production") {
  app.get("/debug", (req, res) => res.send("cp2nus prefix reachable"));
}
app.use("/website", websiteRoutes);
app.get(openapiJsonPath, (req, res) => {
  setNoStoreHeaders(res);
  res.type("application/json").end(JSON.stringify(openapiSpec));
});
app.get("/api/swagger-ui-init.js", (req, res) => {
  setNoStoreHeaders(res);
  res.type("application/javascript").end(buildSwaggerInitScript());
});
app.use("/api", swaggerUi.serve, swaggerUi.setup(null, swaggerUiOptions));

app.get("/webapp", requireTopupEnabledPage("nus"));
app.get("/cp2nus/webapp", requireTopupEnabledPage("nus"));
app.get("/sutd/webapp", requireTopupEnabledPage("sutd"));
app.get("/webapp/pay", requireTopupEnabledPage("nus"));
app.get("/cp2nus/webapp/pay", requireTopupEnabledPage("nus"));
app.get("/sutd/webapp/pay", requireTopupEnabledPage("sutd"));
app.get("/webapp/bootstrap", requireTopupEnabledJson("nus"));
app.get("/cp2nus/webapp/bootstrap", requireTopupEnabledJson("nus"));
app.get("/sutd/webapp/bootstrap", requireTopupEnabledJson("sutd"));
app.post("/webapp/enets_pay", requireTopupEnabledJson("nus"));
app.post("/cp2nus/webapp/enets_pay", requireTopupEnabledJson("nus"));
app.post("/sutd/webapp/enets_pay", requireTopupEnabledJson("sutd"));

app.use("/webapp/bootstrap", paymentBootstrapLimiter);
app.use("/cp2nus/webapp/bootstrap", paymentBootstrapLimiter);
app.use("/sutd/webapp/bootstrap", paymentBootstrapLimiter);
app.use("/webapp/enets_pay", paymentSubmitLimiter);
app.use("/cp2nus/webapp/enets_pay", paymentSubmitLimiter);
app.use("/sutd/webapp/enets_pay", paymentSubmitLimiter);

app.use("/cp2nus", cp2nus);
app.use("/sutd", sutd);
app.use("/", cp2);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  captureException(err, "anonymous", { path: req.path, method: req.method });
  res.status(500).send("Something went wrong.");
});

const port = process.env.PORT || 3000;
let server;

function startServer() {
  if (server) return server;

  server = app.listen(port, "0.0.0.0", () => {
    console.log(`App listening on port: ${port}`);
    startBot().catch((err) => {
      console.error("Failed to start Telegram bot:", err);
      server.close(() => process.exit(1));
    });
  });

  return server;
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await stopBot(signal);
    await shutdownAnalytics();
    process.exit(0);
  });
}

if (require.main === module) {
  startServer();
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = {
  app,
  startServer,
  getBotRuntimeMode,
  get server() {
    return server;
  },
};
