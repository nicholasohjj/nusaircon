import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const originalEnv = { ...process.env };

describe("top-up availability", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: "123456:test",
      TELEGRAM_BOT_AUDIENCE: "nus",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("reports enabled status by default", () => {
    const { getTopupAvailability } = require("../services/topupAvailability");

    expect(getTopupAvailability("nus")).toMatchObject({
      audience: "nus",
      enabled: true,
      disabled: false,
    });
  });

  test("reflects runtime /topupoff state", () => {
    const { getBotContext } = require("../bot/bot");
    const { getTopupAvailability } = require("../services/topupAvailability");

    getBotContext("nus").state.topupDisabled = true;

    expect(getTopupAvailability("nus")).toMatchObject({
      audience: "nus",
      enabled: false,
      disabled: true,
    });
  });

  test("JSON middleware blocks disabled top-up routes", async () => {
    const express = require("express");
    const request = require("supertest");
    const { getBotContext } = require("../bot/bot");
    const { requireTopupEnabledJson } = require("../services/topupAvailability");
    const app = express();

    getBotContext("nus").state.topupDisabled = true;
    app.get("/webapp/bootstrap", requireTopupEnabledJson("nus"), (req, res) =>
      res.json({ ok: true }),
    );

    const res = await request(app).get("/webapp/bootstrap").expect(503);
    expect(res.body).toMatchObject({
      ok: false,
      code: "TOPUP_DISABLED",
      audience: "nus",
    });
  });

  test("page middleware blocks disabled top-up routes", async () => {
    const express = require("express");
    const request = require("supertest");
    const { getBotContext } = require("../bot/bot");
    const { requireTopupEnabledPage } = require("../services/topupAvailability");
    const app = express();

    getBotContext("nus").state.topupDisabled = true;
    app.get("/webapp", requireTopupEnabledPage("nus"), (req, res) =>
      res.send("ok"),
    );

    const res = await request(app).get("/webapp").expect(503);
    expect(res.text).toContain("Top-ups are temporarily unavailable");
  });
});
