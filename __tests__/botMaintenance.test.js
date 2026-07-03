import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const originalEnv = { ...process.env };
let dbDir;

function loadBotMaintenance(env = {}) {
  vi.resetModules();
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "evs-maintenance-"));
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    TELEGRAM_BOT_TOKEN: "123456:test",
    OWNER_CHAT_ID: "42",
    DB_DIR: dbDir,
    ...env,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }

  return {
    botMaintenance: require("../bot/middleware/maintenance"),
    maintenanceMode: require("../services/maintenanceMode"),
    ownerCommands: require("../bot/commands/owner"),
  };
}

function testRuntime() {
  return {
    config: {
      sessionKey: "test",
      mainKeyboard: { reply_markup: { keyboard: [["ok"]] } },
    },
  };
}

beforeEach(() => {
  dbDir = null;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("bot global maintenance mode", () => {
  test("blocks normal user messages during maintenance", async () => {
    const { botMaintenance, maintenanceMode } = loadBotMaintenance();
    const runtime = testRuntime();
    const guard = botMaintenance.createGlobalMaintenanceGuard(runtime);
    const next = vi.fn();
    const ctx = {
      chat: { id: "100" },
      message: { text: "/balance" },
      reply: vi.fn(),
      updateType: "message",
    };

    maintenanceMode.setGlobalMaintenanceEnabled(true);

    await guard(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("temporarily unavailable"),
      runtime.config.mainKeyboard,
    );
  });

  test("lets the owner maintenance commands through", async () => {
    const { botMaintenance, maintenanceMode } = loadBotMaintenance();
    const guard = botMaintenance.createGlobalMaintenanceGuard(testRuntime());
    const next = vi.fn(() => "next");
    const ctx = {
      chat: { id: "42" },
      message: { text: "/maintenanceoff" },
      reply: vi.fn(),
      updateType: "message",
    };

    maintenanceMode.setGlobalMaintenanceEnabled(true);

    const result = await guard(ctx, next);

    expect(result).toBe("next");
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("answers callbacks before sending the maintenance message", async () => {
    const { botMaintenance, maintenanceMode } = loadBotMaintenance();
    const runtime = testRuntime();
    const guard = botMaintenance.createGlobalMaintenanceGuard(runtime);
    const ctx = {
      chat: { id: "100" },
      callbackQuery: { id: "callback-1" },
      answerCbQuery: vi.fn(() => Promise.resolve()),
      reply: vi.fn(),
      updateType: "callback_query",
    };

    maintenanceMode.setGlobalMaintenanceEnabled(true);

    await guard(ctx, vi.fn());

    expect(ctx.answerCbQuery).toHaveBeenCalledWith(
      "Service is temporarily unavailable.",
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("temporarily unavailable"),
      runtime.config.mainKeyboard,
    );
  });

  test("owner commands toggle global maintenance state", async () => {
    const { maintenanceMode, ownerCommands } = loadBotMaintenance();
    const handlers = {};
    const bot = {
      command(name, handler) {
        handlers[name] = handler;
      },
      telegram: { sendMessage: vi.fn() },
    };
    const ctx = {
      chat: { id: "42" },
      reply: vi.fn(),
    };

    maintenanceMode.setGlobalMaintenanceEnabled(false);
    ownerCommands.registerOwnerCommands(bot, {
      state: { topupDisabled: false, runtimeMode: "polling", startedAt: 1 },
      pendingReplies: new Map(),
    });

    await handlers.maintenanceon(ctx);

    expect(maintenanceMode.getGlobalMaintenanceStatus().enabled).toBe(true);
    expect(ctx.reply).toHaveBeenLastCalledWith(
      expect.stringContaining("Maintenance mode is now ON"),
    );

    await handlers.maintenanceoff(ctx);

    expect(maintenanceMode.getGlobalMaintenanceStatus().enabled).toBe(false);
    expect(ctx.reply).toHaveBeenLastCalledWith(
      "Maintenance mode is now OFF. The app and bot are live.",
    );
  });
});
