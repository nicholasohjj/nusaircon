import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-alerts-"));
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const request = require("supertest");
const { HOSTELS, createBotConfig } = require("../bot/constants");
const lowBalanceAlerts = require("../bot/services/lowBalanceAlerts");
const { handleAlertsCommand, parseBalance, runLowBalanceCheck } =
  lowBalanceAlerts;
const { app } = require("../server");

const userStorePath = require.resolve("../bot/services/userStore.js");
const originalUserStore = require.cache[userStorePath];

function loadFreshStore() {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-alerts-"));
  delete require.cache[userStorePath];
  const store = require("../bot/services/userStore.js");
  require.cache[userStorePath] = originalUserStore;
  return store;
}

function makeContexts(sendMessage = vi.fn().mockResolvedValue({})) {
  return {
    sendMessage,
    contexts: ["nus", "sutd"].map((audience) => ({
      config: createBotConfig(audience),
      bot: { telegram: { sendMessage } },
    })),
  };
}

describe("runLowBalanceCheck", () => {
  let store;

  beforeEach(() => {
    store = loadFreshStore();
    store.saveUser("chat-1", "12345678", HOSTELS.CP2NUS, "Room");
    store.setLowBalanceAlerts("chat-1", [HOSTELS.CP2NUS], true);
  });

  test("alerts below the threshold with a top-up button", async () => {
    const { contexts, sendMessage } = makeContexts();

    const summary = await runLowBalanceCheck({
      store,
      contexts,
      fetchBalance: async () => 3.2,
    });

    expect(summary).toMatchObject({ checked: 1, alerted: 1, failed: 0 });
    const [chatId, text, extra] = sendMessage.mock.calls[0];
    expect(chatId).toBe("chat-1");
    expect(text).toContain("SGD 3.20");
    expect(extra.reply_markup.inline_keyboard[0][0].callback_data).toBe(
      "saved_meter:topup:cp2nus:12345678",
    );
  });

  test("does not alert at the threshold", async () => {
    const { contexts, sendMessage } = makeContexts();

    await runLowBalanceCheck({ store, contexts, fetchBalance: async () => 5 });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("ignores meters that have not opted in", async () => {
    store.saveUser("chat-2", "87654321", HOSTELS.CP2NUS);
    const { contexts, sendMessage } = makeContexts();

    await runLowBalanceCheck({ store, contexts, fetchBalance: async () => 1 });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe("chat-1");
  });

  test("alerts once per low-balance episode", async () => {
    const { contexts, sendMessage } = makeContexts();
    const check = (balance) =>
      runLowBalanceCheck({ store, contexts, fetchBalance: async () => balance });

    await check(3);
    await check(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    expect(await check(20)).toMatchObject({ recovered: 1 });
    await check(4);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["null", async () => null],
    [
      "a thrown error",
      async () => {
        throw new Error("EVS down");
      },
    ],
  ])("does not treat %s as a zero balance", async (_name, fetchBalance) => {
    const { contexts, sendMessage } = makeContexts();

    const summary = await runLowBalanceCheck({ store, contexts, fetchBalance });

    expect(summary).toMatchObject({ failed: 1, alerted: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("retries the next day if sending fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({});
    const { contexts } = makeContexts(sendMessage);
    const check = () =>
      runLowBalanceCheck({ store, contexts, fetchBalance: async () => 1 });

    expect(await check()).toMatchObject({ failed: 1, alerted: 0 });
    expect(await check()).toMatchObject({ failed: 0, alerted: 1 });
  });

  test("turns alerts off for a chat that blocked the bot", async () => {
    const blocked = Object.assign(new Error("Forbidden"), {
      response: { error_code: 403 },
    });
    const { contexts } = makeContexts(vi.fn().mockRejectedValue(blocked));

    await runLowBalanceCheck({ store, contexts, fetchBalance: async () => 1 });

    expect(store.getLowBalanceAlertMeters()).toEqual([]);
  });

  test("looks up a shared meter once and alerts each chat", async () => {
    store.saveUser("chat-2", "12345678", HOSTELS.CP2NUS);
    store.setLowBalanceAlerts("chat-2", [HOSTELS.CP2NUS], true);
    const { contexts, sendMessage } = makeContexts();
    const fetchBalance = vi.fn().mockResolvedValue(1);

    await runLowBalanceCheck({ store, contexts, fetchBalance });

    expect(fetchBalance).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test("sends through the bot for the meter's system", async () => {
    store.saveUser("chat-3", "11112222", HOSTELS.SUTD);
    store.setLowBalanceAlerts("chat-3", [HOSTELS.SUTD], true);
    const nusSend = vi.fn().mockResolvedValue({});
    const sutdSend = vi.fn().mockResolvedValue({});
    const contexts = [
      { config: createBotConfig("nus"), bot: { telegram: { sendMessage: nusSend } } },
      { config: createBotConfig("sutd"), bot: { telegram: { sendMessage: sutdSend } } },
    ];

    await runLowBalanceCheck({ store, contexts, fetchBalance: async () => 1 });

    expect(nusSend.mock.calls.map(([chatId]) => chatId)).toEqual(["chat-1"]);
    expect(sutdSend.mock.calls.map(([chatId]) => chatId)).toEqual(["chat-3"]);
  });

  test("forgetting a meter removes its alerts", () => {
    store.forgetUser("chat-1");

    expect(store.getLowBalanceAlertMeters()).toEqual([]);
  });
});

describe("parseBalance", () => {
  test.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["n/a", null],
    [0, 0],
    ["3.50", 3.5],
  ])("parses %s as %s", (value, expected) => {
    expect(parseBalance(value)).toBe(expected);
  });
});

describe("/alerts", () => {
  const config = createBotConfig("nus");
  let store;

  function run(text) {
    const reply = vi.fn().mockResolvedValue({});
    return handleAlertsCommand(
      { chat: { id: "chat-1" }, message: { text }, reply },
      config,
      store,
    ).then(() => reply.mock.calls[0][0]);
  }

  beforeEach(() => {
    store = loadFreshStore();
  });

  test("explains how to save a meter when there are none", async () => {
    expect(await run("/alerts on")).toContain("/topup");
    expect(store.getLowBalanceAlertMeters()).toEqual([]);
  });

  test("is off by default and toggles on and off", async () => {
    store.saveUser("chat-1", "12345678", HOSTELS.CP2NUS, "Room");

    expect(await run("/alerts")).toContain("🔕 Room (12345678)");

    expect(await run("/alerts ON")).toContain("alerts are on");
    expect(store.getLowBalanceAlertMeters()).toHaveLength(1);
    expect(await run("/alerts")).toContain("🔔 Room (12345678)");

    expect(await run("/alerts off")).toContain("alerts are off");
    expect(store.getLowBalanceAlertMeters()).toEqual([]);
  });

  test("leaves meters on the other bot unchanged", async () => {
    store.saveUser("chat-1", "12345678", HOSTELS.CP2NUS);
    store.saveUser("chat-1", "11112222", HOSTELS.SUTD);

    await run("/alerts on");

    expect(store.getLowBalanceAlertMeters().map((m) => m.meterId)).toEqual([
      "12345678",
    ]);
  });
});

describe("POST /internal/low-balance-check", () => {
  let start;

  beforeEach(() => {
    start = vi
      .spyOn(lowBalanceAlerts, "startLowBalanceCheck")
      .mockReturnValue(true);
    process.env.LOW_BALANCE_CRON_SECRET = "right-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOW_BALANCE_CRON_SECRET;
  });

  test("is hidden when no secret is configured", async () => {
    delete process.env.LOW_BALANCE_CRON_SECRET;

    await request(app).post("/internal/low-balance-check").expect(404);
    expect(start).not.toHaveBeenCalled();
  });

  test.each([
    ["no secret", null],
    ["the wrong secret", "Bearer wrong-secret"],
  ])("rejects %s", async (_name, header) => {
    const req = request(app).post("/internal/low-balance-check");
    if (header) req.set("Authorization", header);

    await req.expect(401);
    expect(start).not.toHaveBeenCalled();
  });

  test("starts a check with the right secret", async () => {
    const res = await request(app)
      .post("/internal/low-balance-check")
      .set("Authorization", "Bearer right-secret")
      .expect(202);

    expect(res.body).toEqual({ ok: true, started: true });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
