import { beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let startTopUp;
let saveUser;
let STAGES;
let HOSTELS;

beforeAll(async () => {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-topup-"));

  ({ startTopUp } = await import("../bot/services/topup.js"));
  ({ saveUser } = await import("../bot/services/userStore.js"));
  ({ STAGES, HOSTELS } = await import("../bot/constants.js"));
});

describe("startTopUp", () => {
  test("preserves a CP2 deep-link meter ID when no user is saved", () => {
    const session = startTopUp("deep-link-new-user", "12345678");

    expect(session.txtMtrId).toBe("12345678");
    expect(session.stage).toBe(STAGES.AWAITING_HOSTEL);
  });

  test("uses a deep-link meter ID with the saved hostel", () => {
    saveUser("deep-link-saved-hostel", "87654321", HOSTELS.CP2NUS);

    const session = startTopUp("deep-link-saved-hostel", "12345678");

    expect(session.txtMtrId).toBe("12345678");
    expect(session.hostel).toBe(HOSTELS.CP2NUS);
    expect(session.stage).toBe(STAGES.AWAITING_AMOUNT);
  });

  test("falls back to saved meter details when no deep-link meter is supplied", () => {
    saveUser("saved-details", "87654321", HOSTELS.CP2);

    const session = startTopUp("saved-details");

    expect(session.txtMtrId).toBe("87654321");
    expect(session.hostel).toBe(HOSTELS.CP2);
    expect(session.stage).toBe(STAGES.AWAITING_AMOUNT);
  });
});
