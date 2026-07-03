import { beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let buildOwnerStatusMessage;
let checkDbHealth;
let checkHttpReachability;
let formatCheck;
let formatWindow;

beforeAll(() => {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evs-status-"));
  ({
    buildOwnerStatusMessage,
    checkDbHealth,
    checkHttpReachability,
    formatCheck,
    formatWindow,
  } = require("../bot/services/ownerStatus"));
});

describe("owner status", () => {
  test("formats the status message", () => {
    const message = buildOwnerStatusMessage({
      state: { topupDisabled: false },
      maintenanceStatus: { enabled: true },
      runtimeMode: "webhook",
      db: { ok: true, totalUsers: 12, activeUsers: 7 },
      evs: { ok: true, status: 200, latencyMs: 123 },
      enets: { ok: false, status: 503, latencyMs: 456 },
      paymentFailures: { count: 3, windowMs: 15 * 60 * 1000 },
      submitLockStats: { active: 1 },
    });

    expect(message).toContain("Maintenance mode: ON");
    expect(message).toContain("Top-up mode: enabled");
    expect(message).toContain("Bot runtime: webhook");
    expect(message).toContain("DB: OK (12 saved, 7 active)");
    expect(message).toContain("EVS reachable: OK (HTTP 200, 123ms)");
    expect(message).toContain("eNETS reachable: DOWN (HTTP 503, 456ms)");
    expect(message).toContain("Payment failures (15m): 3");
    expect(message).toContain("Active payment submit locks: 1");
  });

  test("checks database health through the injected stats function", async () => {
    await expect(
      checkDbHealth({
        getStats: () => ({ total: 4, active: 2 }),
      }),
    ).resolves.toEqual({
      ok: true,
      totalUsers: 4,
      activeUsers: 2,
    });

    await expect(
      checkDbHealth({
        getStats: () => {
          throw new Error("disk unavailable");
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "disk unavailable",
    });
  });

  test("checks HTTP reachability with short bounded requests", async () => {
    let nowValue = 1000;
    const now = () => {
      nowValue += 25;
      return nowValue;
    };
    const httpClient = {
      get: vi.fn(() => Promise.resolve({ status: 204 })),
    };

    const result = await checkHttpReachability("EVS", "https://example.test", {
      httpClient,
      timeoutMs: 1234,
      now,
    });

    expect(result).toMatchObject({
      name: "EVS",
      ok: true,
      status: 204,
      latencyMs: 25,
    });
    expect(httpClient.get).toHaveBeenCalledWith(
      "https://example.test",
      expect.objectContaining({
        timeout: 1234,
        validateStatus: expect.any(Function),
      }),
    );
  });

  test("formats helper values", () => {
    expect(formatWindow(15 * 60 * 1000)).toBe("15m");
    expect(formatCheck({ ok: false, error: "ETIMEDOUT", latencyMs: 4000 })).toBe(
      "DOWN (ETIMEDOUT, 4000ms)",
    );
  });
});
