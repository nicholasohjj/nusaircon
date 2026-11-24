import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-groups-"));
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const { HOSTELS, createBotConfig } = require("../bot/constants");
const { parseMeterStartPayload } = require("../bot/services/roommateShare");
const whoPaid = require("../bot/services/whoPaid");
const balanceReset = require("../bot/services/balanceReset");
const {
  createGroupGuard,
  parseGroupCommand,
} = require("../bot/services/groupChat");
const {
  handleInlineQuery,
  buildCardText,
} = require("../bot/services/inlineCards");
const { runLowBalanceCheck } = require("../bot/services/lowBalanceAlerts");
const {
  createGlobalMaintenanceGuard,
} = require("../bot/middleware/maintenance");
const maintenanceMode = require("../services/maintenanceMode");
const { sendPaymentNotification } = require("../services/paymentNotification");
const defaultStore = require("../bot/services/userStore");

const userStorePath = require.resolve("../bot/services/userStore.js");
const originalUserStore = require.cache[userStorePath];

function loadFreshStore() {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-groups-"));
  delete require.cache[userStorePath];
  const store = require("../bot/services/userStore.js");
  require.cache[userStorePath] = originalUserStore;
  return store;
}

// 10:00 on 23 Nov 2026 in Singapore.
const NOW = Date.UTC(2026, 10, 23, 2);
const DAY = 24 * 60 * 60 * 1000;
const NUS = createBotConfig("nus");
const SUTD = createBotConfig("sutd");
const GROUP_ID = -1001234;
const BOT = "TestAirconBot";

function pay(
  store,
  { ref, chatId, amount, paidAt = NOW - DAY, meterId = "12345678" },
) {
  return store.recordTopupPayment({
    ref,
    chatId,
    meterId,
    hostel: HOSTELS.CP2NUS,
    amount,
    paidAt,
  });
}

function groupCtx(text, extra = {}) {
  return {
    chat: { id: GROUP_ID, type: "supergroup" },
    botInfo: { username: BOT },
    message: text === null ? undefined : { text },
    reply: vi.fn().mockResolvedValue({}),
    answerCbQuery: vi.fn().mockResolvedValue(true),
    telegram: { getChatMember: vi.fn() },
    ...extra,
  };
}

function lastReply(ctx) {
  return ctx.reply.mock.calls.at(-1);
}

describe("deep link sources", () => {
  test("reads group and card links", () => {
    expect(parseMeterStartPayload("nus_12345678_group", "nus")).toEqual({
      meterId: "12345678",
      shared: false,
      source: "group",
    });
    expect(parseMeterStartPayload("sutd_12345678_card", "sutd")).toEqual({
      meterId: "12345678",
      shared: false,
      source: "card",
    });
    expect(parseMeterStartPayload("nus_12345678_other", "nus")).toBeNull();
  });
});

describe("payment records", () => {
  let store;
  beforeEach(() => {
    store = loadFreshStore();
  });

  test("counts each payment reference once and sums by chat", () => {
    expect(pay(store, { ref: "A", chatId: 1, amount: 20 })).toBe(true);
    expect(pay(store, { ref: "A", chatId: 1, amount: 20 })).toBe(false);
    pay(store, { ref: "B", chatId: 1, amount: 10 });
    pay(store, { ref: "C", chatId: 2, amount: 15 });
    pay(store, { ref: "D", chatId: 2, amount: 50, paidAt: NOW - 200 * DAY });
    pay(store, { ref: "E", chatId: 3, amount: 9, meterId: "87654321" });

    expect(
      store.getTopupTotals("12345678", [HOSTELS.CP2NUS], NOW - 30 * DAY),
    ).toEqual([
      { chatId: "1", total: 30, count: 2 },
      { chatId: "2", total: 15, count: 1 },
    ]);
  });

  test("/forget also removes that chat's payments", () => {
    pay(store, { ref: "A", chatId: 1, amount: 20 });
    store.saveUser(1, "12345678", HOSTELS.CP2NUS);
    store.forgetUser(1, [HOSTELS.CP2NUS, HOSTELS.CP2]);
    expect(store.getTopupTotals("12345678", [HOSTELS.CP2NUS], 0)).toEqual([]);
  });

  test("a successful notification records the payment once", async () => {
    const bot = {
      telegram: {
        getMe: vi.fn().mockResolvedValue({ username: BOT }),
        sendMessage: vi.fn().mockResolvedValue({}),
      },
    };
    const session = {
      chatId: 555,
      status: "success",
      txtMtrId: "11112222",
      txtAmount: "12.50",
      merchantTxnRef: "REF-NOTIFY-1",
      completedAt: NOW,
    };
    await sendPaymentNotification(bot, session);
    await sendPaymentNotification(bot, { ...session, notifiedAt: NOW });
    await sendPaymentNotification(bot, {
      ...session,
      status: "failed",
      merchantTxnRef: "REF-NOTIFY-2",
    });

    expect(
      defaultStore.getTopupTotals("11112222", [HOSTELS.CP2NUS], 0),
    ).toEqual([{ chatId: "555", total: 12.5, count: 1 }]);
  });
});

describe("/paid", () => {
  let store;
  beforeEach(() => {
    store = loadFreshStore();
  });

  test("counts from the last reset, even after the owner replaces the dates", () => {
    balanceReset.setResetDates("nus", ["2026-11-10"], store, NOW - 30 * DAY);
    // Owner sets next semester's date after the reset has passed.
    balanceReset.setResetDates("nus", ["2027-05-09"], store, NOW);
    expect(whoPaid.paidPeriod("nus", store, NOW)).toEqual({
      since: Date.UTC(2026, 10, 9, 16),
      label: "since the reset on 10 Nov",
    });
    expect(whoPaid.paidPeriod("sutd", store, NOW).label).toBe(
      "in the last 120 days",
    );
  });

  test("a private chat sees itself and an anonymous total for others", () => {
    store.saveUser(1, "12345678", HOSTELS.CP2NUS, "Room");
    pay(store, { ref: "A", chatId: 1, amount: 20 });
    pay(store, { ref: "B", chatId: 2, amount: 15 });
    pay(store, { ref: "C", chatId: 3, amount: 10 });

    const text = whoPaid.buildPrivatePaidText(1, NUS, { store, now: NOW });
    expect(text).toContain("• You: SGD 20.00 (1 top-up)");
    expect(text).toContain("• 2 other people: SGD 25.00 (2 top-ups)");
    expect(text).toContain("Only top-ups made through this bot are counted");
  });

  test("a private chat without a saved meter is told how to get one", () => {
    expect(whoPaid.buildPrivatePaidText(1, NUS, { store, now: NOW })).toContain(
      "Use /topup",
    );
  });

  test("a group names its members and groups everyone else", async () => {
    pay(store, { ref: "A", chatId: 1, amount: 20 });
    pay(store, { ref: "B", chatId: 2, amount: 15 });
    pay(store, { ref: "C", chatId: 3, amount: 6 });
    const ctx = groupCtx("/paid");
    ctx.telegram.getChatMember.mockImplementation(async (_chat, userId) => {
      if (userId === 1)
        return { status: "member", user: { first_name: "Alex <3" } };
      if (userId === 2) return { status: "left", user: { first_name: "Sam" } };
      throw new Error("user not found");
    });

    const text = await whoPaid.buildGroupPaidText(
      ctx,
      { meterId: "12345678" },
      NUS,
      { store, now: NOW },
    );
    expect(text).toContain("• Alex &lt;3: SGD 20.00 (1 top-up)");
    expect(text).not.toContain("Sam");
    expect(text).toContain("• Not in this group: SGD 21.00 (2 top-ups)");
    expect(text).toContain("<b>Total:</b> SGD 41.00");
  });
});

describe("group chats", () => {
  let store;
  let lookup;
  let fetchSummary;
  let guard;
  const runtime = {
    config: NUS,
    state: { topupDisabled: false },
    bot: { botInfo: { username: BOT } },
  };

  beforeEach(() => {
    store = loadFreshStore();
    lookup = vi.fn().mockResolvedValue({});
    fetchSummary = vi
      .fn()
      .mockResolvedValue({ address: "Block A #01-01", credit_bal: "12.3" });
    guard = createGroupGuard(runtime, { store, lookup, fetchSummary });
  });

  test("private chats go on to the normal handlers", async () => {
    const next = vi.fn();
    await guard({ chat: { id: 1, type: "private" } }, next);
    expect(next).toHaveBeenCalled();
  });

  test("group updates never reach the private handlers", async () => {
    const next = vi.fn();
    await guard(groupCtx("hello"), next);
    await guard(groupCtx("12345678"), next);
    expect(next).not.toHaveBeenCalled();
  });

  test("ignores commands addressed to another bot", () => {
    expect(parseGroupCommand("/balance@OtherBot", BOT)).toBeNull();
    expect(parseGroupCommand("/balance@testairconbot", BOT)).toEqual({
      command: "balance",
      args: "",
    });
    expect(parseGroupCommand("/meter 12345678", BOT)).toEqual({
      command: "meter",
      args: "12345678",
    });
  });

  test("/meter links the group with alerts on, and can be changed or removed", async () => {
    const ctx = groupCtx("/meter 12345678");
    await guard(ctx, vi.fn());
    const [text, extra] = lastReply(ctx);
    expect(text).toContain("linked to meter <code>12345678</code>");
    expect(text).toContain("Block A #01-01");
    expect(extra.reply_markup.inline_keyboard[0][0].url).toBe(
      `https://t.me/${BOT}?start=nus_12345678_group`,
    );
    expect(store.getSavedMeters(GROUP_ID)).toMatchObject([
      { meterId: "12345678", hostel: HOSTELS.CP2NUS, lowBalanceAlerts: true },
    ]);
    // A group is not a user: it stays out of broadcasts.
    expect(store.getAllChatIds()).toEqual([]);

    await guard(groupCtx("/meter 87654321"), vi.fn());
    expect(store.getSavedMeters(GROUP_ID).map((m) => m.meterId)).toEqual([
      "87654321",
    ]);

    await guard(groupCtx("/meter off"), vi.fn());
    expect(store.getSavedMeters(GROUP_ID)).toEqual([]);
  });

  test("/meter rejects bad and unknown IDs", async () => {
    const bad = groupCtx("/meter 1234");
    await guard(bad, vi.fn());
    expect(lastReply(bad)[0]).toContain("8 digits");

    fetchSummary.mockRejectedValueOnce(new Error("not found"));
    const unknown = groupCtx("/meter 99999999");
    await guard(unknown, vi.fn());
    expect(lastReply(unknown)[0]).toContain("couldn't look up");
    expect(store.getSavedMeters(GROUP_ID)).toEqual([]);
  });

  test("lookups need a linked meter and use no reply keyboard", async () => {
    const unlinked = groupCtx("/balance");
    await guard(unlinked, vi.fn());
    expect(lastReply(unlinked)[0]).toContain("isn't linked");
    expect(lookup).not.toHaveBeenCalled();

    store.setGroupMeter(GROUP_ID, "12345678", HOSTELS.CP2NUS, [
      HOSTELS.CP2NUS,
      HOSTELS.CP2,
    ]);
    await guard(groupCtx(`/usage@${BOT}`), vi.fn());
    expect(lookup).toHaveBeenCalledWith(
      expect.anything(),
      GROUP_ID,
      "12345678",
      "usage",
      expect.objectContaining({ followUp: false, hostel: HOSTELS.CP2NUS }),
    );
    expect(lookup.mock.calls[0][4].replyMarkup.inline_keyboard[0][0].url).toBe(
      `https://t.me/${BOT}?start=nus_12345678_group`,
    );
  });

  test("/topup sends people to a private chat", async () => {
    store.setGroupMeter(GROUP_ID, "12345678", HOSTELS.CP2NUS, [HOSTELS.CP2NUS]);
    const ctx = groupCtx("/topup");
    await guard(ctx, vi.fn());
    const [text, extra] = lastReply(ctx);
    expect(text).toContain("private chat");
    expect(extra.reply_markup.inline_keyboard[0][0].url).toContain(
      "nus_12345678_group",
    );
    expect(extra.reply_markup.keyboard).toBeUndefined();
  });

  test("/alerts turns the group's alerts on and off", async () => {
    store.setGroupMeter(GROUP_ID, "12345678", HOSTELS.CP2NUS, [HOSTELS.CP2NUS]);
    await guard(groupCtx("/alerts off"), vi.fn());
    expect(store.getSavedMeters(GROUP_ID)[0].lowBalanceAlerts).toBe(false);
    await guard(groupCtx("/alerts on"), vi.fn());
    expect(store.getSavedMeters(GROUP_ID)[0].lowBalanceAlerts).toBe(true);
  });

  test("says hello when added and forgets the meter when removed", async () => {
    const added = groupCtx(null, {
      myChatMember: {
        old_chat_member: { status: "left" },
        new_chat_member: { status: "member" },
      },
    });
    await guard(added, vi.fn());
    expect(lastReply(added)[0]).toContain("/meter 12345678");

    store.setGroupMeter(GROUP_ID, "12345678", HOSTELS.CP2NUS, [HOSTELS.CP2NUS]);
    const removed = groupCtx(null, {
      myChatMember: {
        old_chat_member: { status: "member" },
        new_chat_member: { status: "kicked" },
      },
    });
    await guard(removed, vi.fn());
    expect(removed.reply).not.toHaveBeenCalled();
    expect(store.getSavedMeters(GROUP_ID)).toEqual([]);
  });

  test("keeps the meter when a group becomes a supergroup", async () => {
    store.setGroupMeter(-55, "12345678", HOSTELS.CP2NUS, [HOSTELS.CP2NUS]);
    const ctx = groupCtx(null, {
      chat: { id: -55, type: "group" },
      message: { migrate_to_chat_id: GROUP_ID },
    });
    await guard(ctx, vi.fn());
    expect(store.getSavedMeters(-55)).toEqual([]);
    expect(store.getSavedMeters(GROUP_ID)[0].meterId).toBe("12345678");
  });

  test("buttons pressed in a group are answered, not acted on", async () => {
    const ctx = groupCtx(null, {
      callbackQuery: { data: "saved_meter:topup:new" },
    });
    await guard(ctx, vi.fn());
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(
      expect.stringContaining("private chat"),
    );
  });

  test("low-balance alerts in a group link to a private chat", async () => {
    store.setGroupMeter(GROUP_ID, "12345678", HOSTELS.CP2NUS, [HOSTELS.CP2NUS]);
    const sendMessage = vi.fn().mockResolvedValue({});
    await runLowBalanceCheck({
      store,
      contexts: [
        {
          config: NUS,
          bot: { botInfo: { username: BOT }, telegram: { sendMessage } },
        },
      ],
      fetchBalance: async () => 3,
      fetchAverage: async () => null,
      now: NOW,
    });
    const [chatId, text, extra] = sendMessage.mock.calls[0];
    expect(chatId).toBe(String(GROUP_ID));
    expect(text).toContain("Low balance");
    expect(extra.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "⚡ Top up",
      url: `https://t.me/${BOT}?start=nus_12345678_group`,
      hide: false,
    });
  });
});

describe("inline balance cards", () => {
  let store;
  beforeEach(() => {
    store = loadFreshStore();
  });

  function inlineCtx(query, userId = 42) {
    return {
      inlineQuery: { query },
      from: { id: userId },
      botInfo: { username: BOT },
      answerInlineQuery: vi.fn().mockResolvedValue(true),
    };
  }

  test("a typed meter ID gives a card with a top-up button", async () => {
    const ctx = inlineCtx(" 12345678 ");
    const fetchSummary = vi
      .fn()
      .mockResolvedValue({ address: "Block A", credit_bal: "3.5" });
    await handleInlineQuery(ctx, NUS, { store, fetchSummary, now: NOW });

    expect(fetchSummary).toHaveBeenCalledWith("12345678", HOSTELS.CP2NUS);
    const [results, extra] = ctx.answerInlineQuery.mock.calls[0];
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Meter 12345678: SGD 3.50");
    expect(results[0].input_message_content.message_text).toContain(
      "Running low",
    );
    expect(results[0].reply_markup.inline_keyboard[0][0].url).toBe(
      `https://t.me/${BOT}?start=nus_12345678_card`,
    );
    expect(extra.is_personal).toBe(false);
  });

  test("an empty query offers the person's saved meters", async () => {
    store.saveUser(42, "11111111", HOSTELS.SUTD, "My room");
    store.saveUser(42, "22222222", HOSTELS.CP2NUS, "Other bot");
    const ctx = inlineCtx("");
    const fetchSummary = vi.fn().mockResolvedValue({ credit_bal: "20" });
    await handleInlineQuery(ctx, SUTD, { store, fetchSummary, now: NOW });

    const [results, extra] = ctx.answerInlineQuery.mock.calls[0];
    expect(results.map((r) => r.title)).toEqual(["My room: SGD 20.00"]);
    expect(results[0].reply_markup.inline_keyboard[0][0].url).toContain(
      "sutd_11111111_card",
    );
    expect(extra.is_personal).toBe(true);
  });

  test("anything else, or a failed lookup, points to the bot", async () => {
    const partial = inlineCtx("1234");
    const fetchSummary = vi.fn().mockRejectedValue(new Error("down"));
    await handleInlineQuery(partial, NUS, { store, fetchSummary, now: NOW });
    expect(fetchSummary).not.toHaveBeenCalled();
    expect(partial.answerInlineQuery.mock.calls[0][1].button.text).toBe(
      "Type an 8-digit meter ID",
    );

    const failed = inlineCtx("12345678");
    await handleInlineQuery(failed, NUS, { store, fetchSummary, now: NOW });
    expect(failed.answerInlineQuery.mock.calls[0][0]).toEqual([]);
  });

  test("the card escapes the address and shows when it was checked", () => {
    const text = buildCardText({
      meterId: "12345678",
      summary: { address: "A&B", credit_bal: null },
      now: NOW,
    });
    expect(text).toContain("🏠 A&amp;B");
    expect(text).toContain("Balance: unavailable");
    expect(text).toContain("Checked 23 Nov, 10:00");
  });
});

describe("maintenance in groups and inline mode", () => {
  test("stays quiet in groups except for commands, and answers inline queries", async () => {
    maintenanceMode.setGlobalMaintenanceEnabled(true);
    try {
      const guard = createGlobalMaintenanceGuard({ config: NUS });
      const chatter = groupCtx("hello");
      await guard(chatter, vi.fn());
      expect(chatter.reply).not.toHaveBeenCalled();

      const command = groupCtx("/balance");
      await guard(command, vi.fn());
      expect(command.reply).toHaveBeenCalledWith(
        expect.stringContaining("temporarily unavailable"),
      );

      const inline = {
        inlineQuery: { query: "" },
        answerInlineQuery: vi.fn().mockResolvedValue(true),
      };
      await guard(inline, vi.fn());
      expect(inline.answerInlineQuery).toHaveBeenCalledWith([], {
        cache_time: 0,
      });
    } finally {
      maintenanceMode.setGlobalMaintenanceEnabled(false);
    }
  });
});
