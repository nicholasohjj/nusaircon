import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { inferRuntimeMode, shouldUseWebhook } = require("../bot/runtimeMode");

const managedEnvKeys = [
  "NODE_ENV",
  "RAILWAY_PUBLIC_DOMAIN",
  "TELEGRAM_BOT_MODE",
];
let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(
    managedEnvKeys.map((key) => [key, process.env[key]]),
  );

  for (const key of managedEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of managedEnvKeys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe("Telegram runtime mode inference", () => {
  test("uses polling by default outside production", () => {
    expect(inferRuntimeMode()).toBe("polling");
    expect(shouldUseWebhook()).toBe(false);
  });

  test("uses webhook in production", () => {
    process.env.NODE_ENV = "production";

    expect(inferRuntimeMode()).toBe("webhook");
    expect(shouldUseWebhook()).toBe(true);
  });

  test("uses webhook on Railway public-domain deployments", () => {
    process.env.NODE_ENV = "development";
    process.env.RAILWAY_PUBLIC_DOMAIN = "evs.example.up.railway.app";

    expect(inferRuntimeMode()).toBe("webhook");
    expect(shouldUseWebhook()).toBe(true);
  });

  test("honors explicit polling override on Railway", () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = "evs.example.up.railway.app";
    process.env.TELEGRAM_BOT_MODE = "polling";

    expect(inferRuntimeMode()).toBe("polling");
    expect(shouldUseWebhook()).toBe(false);
  });

  test("rejects unsupported explicit modes", () => {
    process.env.TELEGRAM_BOT_MODE = "serverless";

    expect(() => inferRuntimeMode()).toThrow(
      'Unsupported TELEGRAM_BOT_MODE "serverless"',
    );
  });
});
