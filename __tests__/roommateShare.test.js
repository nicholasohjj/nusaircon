import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildShareUrl,
  parseMeterStartPayload,
  roommateShareKeyboard,
} = require("../bot/services/roommateShare");
const { sendPaymentNotification } = require("../services/paymentNotification");

function makeBot(
  getMe = vi.fn().mockResolvedValue({ username: "TestAirconBot" }),
) {
  return {
    telegram: { getMe, sendMessage: vi.fn().mockResolvedValue({}) },
  };
}

function shareButton(keyboard) {
  return keyboard?.reply_markup?.inline_keyboard?.[0]?.[0];
}

describe("parseMeterStartPayload", () => {
  test("reads plain and shared links", () => {
    expect(parseMeterStartPayload("nus_12345678", "nus")).toEqual({
      meterId: "12345678",
      shared: false,
    });
    expect(parseMeterStartPayload("nus_12345678_share", "nus")).toEqual({
      meterId: "12345678",
      shared: true,
    });
  });

  test("only allows a missing prefix when asked", () => {
    expect(parseMeterStartPayload("12345678", "sutd")).toBeNull();
    expect(
      parseMeterStartPayload("12345678_share", "sutd", {
        prefixOptional: true,
      }),
    ).toEqual({ meterId: "12345678", shared: true });
  });

  test("rejects anything else", () => {
    expect(parseMeterStartPayload("nus_1234567", "nus")).toBeNull();
    expect(parseMeterStartPayload("sutd_12345678", "nus")).toBeNull();
    expect(parseMeterStartPayload("nus_12345678_other", "nus")).toBeNull();
    expect(parseMeterStartPayload("", "nus")).toBeNull();
  });
});

describe("roommateShareKeyboard", () => {
  test("links to the bot with the meter filled in", async () => {
    const keyboard = await roommateShareKeyboard(makeBot(), "nus", "12345678");
    const url = new URL(shareButton(keyboard).url);
    expect(url.origin + url.pathname).toBe("https://t.me/share/url");
    expect(url.searchParams.get("url")).toBe(
      "https://t.me/TestAirconBot?start=nus_12345678_share",
    );
    expect(url.searchParams.get("text")).toContain("aircon");
  });

  test("uses the SUTD prefix on the SUTD bot", () => {
    const url = new URL(buildShareUrl("SutdBot", "sutd", "20000596"));
    expect(url.searchParams.get("url")).toBe(
      "https://t.me/SutdBot?start=sutd_20000596_share",
    );
  });

  test("looks up the username once per bot", async () => {
    const bot = makeBot();
    await roommateShareKeyboard(bot, "nus", "12345678");
    await roommateShareKeyboard(bot, "nus", "87654321");
    expect(bot.telegram.getMe).toHaveBeenCalledTimes(1);
  });

  test("gives up quietly without a username or a valid meter", async () => {
    const failing = makeBot(vi.fn().mockRejectedValue(new Error("down")));
    expect(await roommateShareKeyboard(failing, "nus", "12345678")).toBeNull();
    expect(await roommateShareKeyboard(makeBot(), "nus", "abc")).toBeNull();
  });
});

describe("payment notification share button", () => {
  let ref = 0;
  function session(status) {
    ref += 1;
    return {
      chatId: 42,
      status,
      txtMtrId: "12345678",
      txtAmount: "10",
      merchantTxnRef: `REF${ref}`,
      completedAt: ref,
    };
  }

  test("is added to successful top-ups", async () => {
    const bot = makeBot();
    await sendPaymentNotification(bot, session("success"), {
      audience: "sutd",
    });
    const [, , extra] = bot.telegram.sendMessage.mock.calls[0];
    expect(shareButton(extra).url).toContain("sutd_12345678_share");
  });

  test("is left off failed top-ups", async () => {
    const bot = makeBot();
    await sendPaymentNotification(bot, session("failed"));
    const [, , extra] = bot.telegram.sendMessage.mock.calls[0];
    expect(extra.reply_markup).toBeUndefined();
    expect(bot.telegram.getMe).not.toHaveBeenCalled();
  });

  test("does not stop the message when Telegram can't give a username", async () => {
    const bot = makeBot(vi.fn().mockRejectedValue(new Error("down")));
    await sendPaymentNotification(bot, session("success"));
    const [, text, extra] = bot.telegram.sendMessage.mock.calls[0];
    expect(text).toContain("Top-Up Successful");
    expect(extra.reply_markup).toBeUndefined();
  });
});
