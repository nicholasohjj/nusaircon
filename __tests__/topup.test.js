import { beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let startTopUp;
let handleTopUpStart;
let getWebAppPath;
let saveUser;
let STAGES;
let HOSTELS;

beforeAll(async () => {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-topup-"));

  ({ getWebAppPath, handleTopUpStart, startTopUp } = await import(
    "../bot/services/topup.js"
  ));
  ({ saveUser } = await import("../bot/services/userStore.js"));
  ({ STAGES, HOSTELS } = await import("../bot/constants.js"));
});

describe("startTopUp", () => {
  test("uses cp2nus for a deep-link meter ID when no user is saved", () => {
    const session = startTopUp("deep-link-new-user", "12345678");

    expect(session.txtMtrId).toBe("12345678");
    expect(session.hostel).toBe(HOSTELS.CP2NUS);
    expect(session.stage).toBe(STAGES.AWAITING_AMOUNT);
  });

  test("uses a deep-link meter ID with the saved hostel", () => {
    saveUser("deep-link-saved-hostel", "87654321", HOSTELS.CP2NUS);

    const session = startTopUp("deep-link-saved-hostel", "12345678");

    expect(session.txtMtrId).toBe("12345678");
    expect(session.hostel).toBe(HOSTELS.CP2NUS);
    expect(session.stage).toBe(STAGES.AWAITING_AMOUNT);
  });

  test("ignores saved legacy cp2 details now that the fallback is hidden", () => {
    saveUser("saved-details", "87654321", HOSTELS.CP2);

    const session = startTopUp("saved-details");

    expect(session.txtMtrId).toBeUndefined();
    expect(session.hostel).toBe(HOSTELS.CP2NUS);
    expect(session.stage).toBe(STAGES.AWAITING_METER_ID);
  });

  test("prompts for a saved meter when multiple meters exist", async () => {
    saveUser("multiple-saved", "11111111", HOSTELS.CP2NUS, "Room");
    saveUser("multiple-saved", "22222222", HOSTELS.CP2NUS, "Friend");
    const ctx = { reply: vi.fn() };

    await handleTopUpStart(ctx, "multiple-saved");

    expect(ctx.reply).toHaveBeenCalledWith(
      "Choose a saved meter for top-up:",
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [
              expect.objectContaining({
                text: expect.stringContaining("Friend"),
              }),
            ],
          ]),
        }),
      }),
    );
  });

  test("skips the hostel picker and asks for a meter ID for new NUS users", async () => {
    const ctx = { reply: vi.fn() };

    await handleTopUpStart(ctx, "new-nus-user");

    expect(ctx.reply).toHaveBeenCalledWith(
      "🔌 Please enter your 8-digit Meter ID:",
      expect.any(Object),
    );
  });

  test("routes cp2nus as primary and keeps cp2 as legacy", () => {
    expect(getWebAppPath(HOSTELS.CP2NUS)).toBe("/cp2nus/webapp");
    expect(getWebAppPath(HOSTELS.CP2)).toBe("/webapp");
  });
});
