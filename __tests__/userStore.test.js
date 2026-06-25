import { beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const userStorePath = require.resolve("../bot/services/userStore.js");
const { HOSTELS } = require("../bot/constants");

function loadUserStore() {
  delete require.cache[userStorePath];
  return require("../bot/services/userStore.js");
}

function makeDbDir(prefix = "evs-user-store-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DB_DIR = dir;
  return dir;
}

describe("userStore saved meters", () => {
  beforeEach(() => {
    makeDbDir();
  });

  test("saves multiple meters and switches the active meter", () => {
    const {
      forgetSavedMeter,
      getSavedMeters,
      getUser,
      saveUser,
      setActiveSavedMeter,
    } = loadUserStore();

    saveUser("chat-1", "12345678", HOSTELS.CP2, "Room");
    saveUser("chat-1", "87654321", HOSTELS.CP2NUS, "Friend");

    expect(getSavedMeters("chat-1")).toHaveLength(2);
    expect(getUser("chat-1")).toMatchObject({
      meterId: "87654321",
      hostel: HOSTELS.CP2NUS,
      label: "Friend",
    });

    expect(setActiveSavedMeter("chat-1", "12345678", HOSTELS.CP2)).toBe(true);
    expect(getUser("chat-1")).toMatchObject({
      meterId: "12345678",
      hostel: HOSTELS.CP2,
      label: "Room",
    });

    expect(forgetSavedMeter("chat-1", "12345678", HOSTELS.CP2)).toBe(true);
    expect(getSavedMeters("chat-1")).toHaveLength(1);
    expect(getUser("chat-1")).toMatchObject({
      meterId: "87654321",
      hostel: HOSTELS.CP2NUS,
    });
  });

  test("migrates legacy single-meter users into user_meters", () => {
    const dbDir = makeDbDir("evs-user-store-legacy-");
    const Database = require("better-sqlite3");
    const db = new Database(path.join(dbDir, "evs_users.db"));
    db.exec(`
      CREATE TABLE users (
        chat_id   TEXT PRIMARY KEY,
        meter_id  TEXT NOT NULL,
        hostel    TEXT NOT NULL,
        saved_at  INTEGER NOT NULL
      );
      INSERT INTO users (chat_id, meter_id, hostel, saved_at)
      VALUES ('legacy-chat', '11223344', '${HOSTELS.CP2}', 1000);
    `);
    db.close();

    const { getSavedMeters, getUser } = loadUserStore();

    expect(getUser("legacy-chat")).toMatchObject({
      meterId: "11223344",
      hostel: HOSTELS.CP2,
      label: "Meter 3344",
    });
    expect(getSavedMeters("legacy-chat")).toEqual([
      expect.objectContaining({
        meterId: "11223344",
        hostel: HOSTELS.CP2,
        label: "Meter 3344",
        lastUsed: 1000,
      }),
    ]);
  });
});
