const fs = require("fs");

function isRailwayRuntime(env = process.env) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT ||
      env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_PUBLIC_DOMAIN,
  );
}

function resolveDbDir({
  env = process.env,
  dataDirExists = fs.existsSync("/data"),
} = {}) {
  const configuredDir = env.DB_DIR?.trim();

  if (configuredDir) {
    if (
      configuredDir === "/data" &&
      !dataDirExists &&
      !isRailwayRuntime(env)
    ) {
      return ".";
    }

    return configuredDir;
  }

  return dataDirExists ? "/data" : ".";
}

module.exports = {
  isRailwayRuntime,
  resolveDbDir,
};
