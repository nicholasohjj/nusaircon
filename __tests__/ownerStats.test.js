import { beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let buildOwnerStatsMessage;
let formatStageCounts;
let formatUptime;

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.PAYMENT_SESSION_SECRET = "test-payment-session-secret";
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-owner-"));

  ({
    buildOwnerStatsMessage,
    formatStageCounts,
    formatUptime,
  } = require("../bot/commands/owner"));
});

describe("owner stats formatting", () => {
  test("formats uptime compactly", () => {
    expect(formatUptime(1_000, 61_000)).toBe("1m");
    expect(formatUptime(1_000, 3_661_000)).toBe("1h 1m");
    expect(formatUptime(1_000, 90_061_000)).toBe("1d 1h");
  });

  test("formats empty and populated stage counts", () => {
    expect(formatStageCounts({})).toBe("none");
    expect(formatStageCounts({ idle: 2, awaiting_amount: 1 })).toBe(
      "awaiting_amount: 1, idle: 2",
    );
  });

  test("builds the owner stats message", () => {
    const message = buildOwnerStatsMessage({
      state: {
        topupDisabled: false,
        runtimeMode: "webhook",
        startedAt: 1_000,
      },
      userStats: { total: 12, active: 7 },
      sessionStats: {
        total: 3,
        byStage: { idle: 2, awaiting_payment: 1 },
        queuedHandlers: 1,
        lockedChats: 1,
      },
      pendingReplyCount: 2,
      submitLockStats: { active: 1 },
      now: 61_000,
    });

    expect(message).toContain("Top-ups: enabled");
    expect(message).toContain("Runtime: webhook");
    expect(message).toContain("Saved users: 12");
    expect(message).toContain("Active users (30d): 7");
    expect(message).toContain("Bot sessions: 3");
    expect(message).toContain("Pending owner replies: 2");
    expect(message).toContain("Active payment submit locks: 1");
    expect(message).toContain("Payment token secret: dedicated");
  });
});
