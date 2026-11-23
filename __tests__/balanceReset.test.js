import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-reset-"));
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const { HOSTELS, createBotConfig } = require("../bot/constants");
const balanceReset = require("../bot/services/balanceReset");
const { runLowBalanceCheck } = require("../bot/services/lowBalanceAlerts");
const { handleResetDateCommand } = require("../bot/commands/owner");

const userStorePath = require.resolve("../bot/services/userStore.js");
const originalUserStore = require.cache[userStorePath];

function loadFreshStore() {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-reset-"));
  delete require.cache[userStorePath];
  const store = require("../bot/services/userStore.js");
  require.cache[userStorePath] = originalUserStore;
  return store;
}

// 10:00 on 23 Nov 2026 in Singapore.
const NOW = Date.UTC(2026, 10, 23, 2);
const NUS = createBotConfig("nus");
const SUTD = createBotConfig("sutd");

function makeContexts(sendMessage = vi.fn().mockResolvedValue({})) {
  return {
    sendMessage,
    contexts: [NUS, SUTD].map((config) => ({
      config,
      bot: { telegram: { sendMessage } },
    })),
  };
}

describe("dates", () => {
  test("parses only real calendar dates", () => {
    expect(balanceReset.parseResetDate("2026-12-13")).toBe("2026-12-13");
    expect(balanceReset.parseResetDate("2026-02-30")).toBeNull();
    expect(balanceReset.parseResetDate("13/12/2026")).toBeNull();
    expect(balanceReset.parseResetDate("")).toBeNull();
  });

  test("counts days in Singapore time", () => {
    expect(balanceReset.daysUntil("2026-12-13", NOW)).toBe(20);
    expect(balanceReset.daysUntil("2026-11-23", NOW)).toBe(0);
    // 23:30 on 22 Nov UTC is already 23 Nov in Singapore.
    expect(
      balanceReset.daysUntil("2026-11-24", Date.UTC(2026, 10, 22, 23, 30)),
    ).toBe(1);
    expect(balanceReset.daysUntil("2026-11-20", NOW)).toBe(-3);
  });

  test("picks the closest reminder stage that is due", () => {
    expect(balanceReset.dueReminderStage(20)).toBeNull();
    expect(balanceReset.dueReminderStage(14)).toBe(14);
    expect(balanceReset.dueReminderStage(4)).toBe(14);
    expect(balanceReset.dueReminderStage(3)).toBe(3);
    expect(balanceReset.dueReminderStage(0)).toBe(3);
    expect(balanceReset.dueReminderStage(-1)).toBeNull();
  });
});

describe("buildTopupAdvice", () => {
  const base = {
    resetDate: "2026-12-13",
    daysLeft: 20,
    hostel: HOSTELS.CP2NUS,
  };

  test("stays quiet when the reset is far off or past", () => {
    expect(buildAdvice({ daysLeft: 29 })).toBeNull();
    expect(buildAdvice({ daysLeft: -1 })).toBeNull();
    expect(buildAdvice({ resetDate: null })).toBeNull();
  });

  test("says no top-up is needed when the balance covers the rest", () => {
    const text = buildAdvice({ balance: 18, avgDaily: 0.8 });
    expect(text).toContain("SGD 16.00");
    expect(text).toContain("may not need to top up");
  });

  test("suggests the shortfall", () => {
    const text = buildAdvice({ balance: 4, avgDaily: 1 });
    expect(text).toContain("about SGD 16.00 more");
  });

  test("points to the minimum when the shortfall is below it", () => {
    const text = buildAdvice({ balance: 15, avgDaily: 0.8 });
    expect(text).toContain("minimum top-up of SGD 6.00");
    const sutd = buildAdvice({
      hostel: HOSTELS.SUTD,
      balance: 15,
      avgDaily: 0.8,
    });
    expect(sutd).toContain("minimum top-up of SGD 10.00");
  });

  test("falls back to the date when usage is unknown", () => {
    const text = buildAdvice({ balance: 12.5, avgDaily: null });
    expect(text).toContain("13 Dec");
    expect(text).toContain("You have SGD 12.50");
  });

  test("warns that a top-up on reset day will be lost", () => {
    expect(buildAdvice({ daysLeft: 0 })).toContain("most likely be lost");
  });

  function buildAdvice(overrides) {
    return balanceReset.buildTopupAdvice({
      balance: null,
      avgDaily: null,
      ...base,
      ...overrides,
    });
  }
});

describe("sendTopupAdvice", () => {
  let store;
  let ctx;

  beforeEach(() => {
    store = loadFreshStore();
    ctx = { reply: vi.fn().mockResolvedValue({}) };
  });

  test("does nothing without a reset date", async () => {
    const fetchBalance = vi.fn();
    await balanceReset.sendTopupAdvice(
      ctx,
      { meterId: "12345678", hostel: HOSTELS.CP2NUS, config: NUS },
      { store, now: NOW, fetchBalance },
    );
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(fetchBalance).not.toHaveBeenCalled();
  });

  test("uses each bot's own date", async () => {
    balanceReset.setResetDates("sutd", ["2026-12-13"], store);
    await balanceReset.sendTopupAdvice(
      ctx,
      { meterId: "12345678", hostel: HOSTELS.CP2NUS, config: NUS },
      { store, now: NOW, fetchBalance: async () => 10 },
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("looks up the balance and usage when not given", async () => {
    balanceReset.setResetDates("nus", ["2026-12-13"], store);
    await balanceReset.sendTopupAdvice(
      ctx,
      { meterId: "12345678", hostel: HOSTELS.CP2NUS, config: NUS },
      {
        store,
        now: NOW,
        fetchBalance: async () => 4,
        fetchAverage: async () => 1,
      },
    );
    expect(ctx.reply.mock.calls[0][0]).toContain("about SGD 16.00 more");
  });

  test("still sends the date when lookups fail", async () => {
    balanceReset.setResetDates("nus", ["2026-12-13"], store);
    await balanceReset.sendTopupAdvice(
      ctx,
      { meterId: "12345678", hostel: HOSTELS.CP2NUS, config: NUS },
      {
        store,
        now: NOW,
        fetchBalance: async () => {
          throw new Error("EVS down");
        },
        fetchAverage: async () => {
          throw new Error("EVS down");
        },
      },
    );
    expect(ctx.reply.mock.calls[0][0]).toContain("Only top up what you'll use");
  });

  test("never throws when the reply fails", async () => {
    balanceReset.setResetDates("nus", ["2026-12-13"], store);
    ctx.reply.mockRejectedValue(new Error("blocked"));
    await expect(
      balanceReset.sendTopupAdvice(
        ctx,
        {
          meterId: "12345678",
          hostel: HOSTELS.CP2NUS,
          config: NUS,
          balance: 5,
          avgDaily: 1,
        },
        { store, now: NOW },
      ),
    ).resolves.toBeNull();
  });
});

describe("reset reminders in the daily check", () => {
  let store;

  beforeEach(() => {
    store = loadFreshStore();
    store.saveUser("chat-1", "12345678", HOSTELS.CP2NUS, "Room");
    store.setLowBalanceAlerts("chat-1", [HOSTELS.CP2NUS], true);
    balanceReset.setResetDates("nus", ["2026-12-03"], store); // 10 days away
  });

  function run(overrides = {}) {
    const { contexts, sendMessage } = makeContexts(overrides.sendMessage);
    return runLowBalanceCheck({
      store,
      contexts,
      fetchBalance: async () => 20,
      fetchAverage: async () => 1,
      now: NOW,
      ...overrides,
    }).then((summary) => ({ summary, sendMessage }));
  }

  test("warns once per stage about credit that will be lost", async () => {
    const first = await run();
    expect(first.summary.resetReminded).toBe(1);
    const [chatId, text] = first.sendMessage.mock.calls[0];
    expect(chatId).toBe("chat-1");
    expect(text).toContain("about SGD 10.00 will be left on 3 Dec");

    const second = await run();
    expect(second.sendMessage).not.toHaveBeenCalled();

    // Three days out is a new stage.
    const third = await run({ now: NOW + 7 * 24 * 60 * 60 * 1000 });
    expect(third.summary.resetReminded).toBe(1);
  });

  test("skips meters that will use up their credit", async () => {
    const { sendMessage } = await run({ fetchAverage: async () => 1.9 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("goes by the balance alone when usage is unknown", async () => {
    const { sendMessage } = await run({ fetchAverage: async () => null });
    expect(sendMessage.mock.calls[0][1]).toContain(
      "Anything still on the meter on 3 Dec is forfeited",
    );
  });

  test("stays quiet before the first stage and without a date", async () => {
    balanceReset.setResetDates("nus", ["2026-12-31"], store);
    expect((await run()).sendMessage).not.toHaveBeenCalled();
    balanceReset.setResetDates("nus", [], store);
    expect((await run()).sendMessage).not.toHaveBeenCalled();
  });

  test("still sends the low-balance alert", async () => {
    const { summary } = await run({
      fetchBalance: async () => 3,
      fetchAverage: async () => null,
    });
    expect(summary).toMatchObject({ alerted: 1, resetReminded: 1 });
  });
});

describe("/resetdate", () => {
  let store;

  beforeEach(() => {
    store = loadFreshStore();
  });

  function command(text) {
    const ctx = {
      chat: { id: 1 },
      message: { text },
      reply: vi.fn().mockResolvedValue({}),
    };
    return handleResetDateCommand(ctx, NUS, store).then(
      () => ctx.reply.mock.calls[0][0],
    );
  }

  function daysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  test("sets, shows and clears dates for this bot only", async () => {
    const soon = daysFromNow(20);
    const later = daysFromNow(180);
    const reply = await command(`/resetdate ${later}, ${soon}`);
    expect(reply.indexOf(soon)).toBeLessThan(reply.indexOf(later));
    expect(balanceReset.getResetDates("nus", store)).toEqual([soon, later]);
    expect(balanceReset.getResetDate("nus", store)).toBe(soon);
    expect(balanceReset.getResetDate("sutd", store)).toBeNull();
    expect(await command("/resetdate")).toContain(later);

    // A new list replaces the old one.
    await command(`/resetdate ${later}`);
    expect(balanceReset.getResetDates("nus", store)).toEqual([later]);

    expect(await command("/resetdate off")).toContain("cleared");
    expect(balanceReset.getResetDates("nus", store)).toEqual([]);
  });

  test("rejects the whole list if any date is bad or past", async () => {
    const soon = daysFromNow(20);
    expect(await command(`/resetdate ${soon} 2026-02-30`)).toContain(
      "Not a valid date: 2026-02-30",
    );
    expect(await command(`/resetdate ${soon} 2000-01-01`)).toContain(
      "Already past: 2000-01-01",
    );
    expect(balanceReset.getResetDates("nus", store)).toEqual([]);
  });
});

describe("multiple reset dates", () => {
  test("follows the next date once one passes", () => {
    const store = loadFreshStore();
    balanceReset.setResetDates("nus", ["2027-05-09", "2026-12-06"], store);
    expect(balanceReset.getResetDate("nus", store, NOW)).toBe("2026-12-06");
    // Reset day itself still counts.
    const dec6 = Date.UTC(2026, 11, 6, 2);
    expect(balanceReset.getResetDate("nus", store, dec6)).toBe("2026-12-06");
    const dec7 = Date.UTC(2026, 11, 7, 2);
    expect(balanceReset.getResetDate("nus", store, dec7)).toBe("2027-05-09");
    const after = Date.UTC(2027, 4, 10, 2);
    expect(balanceReset.getResetDate("nus", store, after)).toBeNull();
  });

  test("reminds again for the next semester", async () => {
    const store = loadFreshStore();
    store.saveUser("chat-1", "12345678", HOSTELS.CP2NUS, "Room");
    store.setLowBalanceAlerts("chat-1", [HOSTELS.CP2NUS], true);
    balanceReset.setResetDates("nus", ["2026-12-06", "2027-05-09"], store);
    const { contexts, sendMessage } = makeContexts();
    const check = (now) =>
      runLowBalanceCheck({
        store,
        contexts,
        fetchBalance: async () => 20,
        fetchAverage: async () => null,
        now,
      });

    await check(NOW);
    await check(Date.UTC(2027, 3, 30, 2)); // 9 days before 9 May
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][1]).toContain("9 May");
  });
});
