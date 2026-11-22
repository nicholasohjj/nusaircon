import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const originalEnv = { ...process.env };

const projectRoot = path.resolve(import.meta.dirname, "..");

function load() {
  // vi.resetModules() leaves require's cache alone, so clear the project's
  // modules to get a fresh userStore on a fresh DB_DIR.
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(projectRoot) && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  }
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    TELEGRAM_BOT_TOKEN: "123456:test",
    OWNER_CHAT_ID: "42",
    DB_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "evs-broadcast-")),
  };
  return {
    owner: require("../bot/commands/owner"),
    store: require("../bot/services/userStore"),
    constants: require("../bot/constants"),
  };
}

// A bot that records registered commands and rejects messages to `blocked`.
function fakeBot(blocked = []) {
  const commands = {};
  const sendMessage = vi.fn(async (chatId) => {
    if (blocked.includes(String(chatId))) {
      const err = new Error("Forbidden");
      err.response = { error_code: 403 };
      throw err;
    }
  });
  return {
    commands,
    sendMessage,
    bot: {
      command: (name, handler) => {
        commands[name] = handler;
      },
      telegram: { sendMessage },
    },
  };
}

function ownerCtx(text) {
  return { chat: { id: "42" }, message: { text }, reply: vi.fn() };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("owner /announce and /broadcast", () => {
  test("each bot only messages users with meters on its own system", async () => {
    const { owner, store, constants } = load();
    const { HOSTELS, createBotConfig } = constants;
    store.saveUser("nus-user", "11111111", HOSTELS.CP2NUS);
    store.saveUser("legacy-user", "22222222", HOSTELS.CP2);
    store.saveUser("sutd-user", "33333333", HOSTELS.SUTD);

    const nus = fakeBot();
    owner.registerOwnerCommands(nus.bot, { config: createBotConfig("nus") });
    await nus.commands.announce(ownerCtx("/announce hello"));

    const sutd = fakeBot();
    owner.registerOwnerCommands(sutd.bot, { config: createBotConfig("sutd") });
    await sutd.commands.broadcast(ownerCtx("/broadcast hello"));

    expect(nus.sendMessage.mock.calls.map(([id]) => id).sort()).toEqual([
      "legacy-user",
      "nus-user",
    ]);
    expect(sutd.sendMessage.mock.calls.map(([id]) => id)).toEqual([
      "sutd-user",
    ]);
  });

  test("a blocked bot only forgets that bot's meters", async () => {
    const { owner, store, constants } = load();
    const { HOSTELS, createBotConfig } = constants;
    store.saveUser("both", "11111111", HOSTELS.CP2NUS);
    store.saveUser("both", "33333333", HOSTELS.SUTD);

    const sutd = fakeBot(["both"]);
    owner.registerOwnerCommands(sutd.bot, { config: createBotConfig("sutd") });
    const ctx = ownerCtx("/broadcast hello");
    await sutd.commands.broadcast(ctx);

    expect(ctx.reply).toHaveBeenLastCalledWith(
      "✅ Broadcast complete. Sent: 0, Failed: 1.",
    );
    expect(store.getSavedMeters("both")).toEqual([
      expect.objectContaining({ meterId: "11111111", hostel: HOSTELS.CP2NUS }),
    ]);
  });
});
