import { describe, expect, test, vi } from "vitest";

const {
  CP2NUS_ON_CP2_ERROR,
  createCp2SystemGuard,
} = require("../services/meterSystemGuard");

describe("CP2 meter system guard", () => {
  test("allows meters recognized by CP2", async () => {
    const cp2MeterCheck = vi.fn().mockResolvedValue({
      ok: true,
      result: "valid",
    });
    const cp2nusMeterCheck = vi.fn();
    const guard = createCp2SystemGuard({
      cp2MeterCheck,
      cp2nusMeterCheck,
    });

    await expect(
      guard({ txtMtrId: "12345678", txtAmount: "20" }),
    ).resolves.toMatchObject({ ok: true });
    expect(cp2nusMeterCheck).not.toHaveBeenCalled();
  });

  test("rejects CP2NUS meters submitted to CP2", async () => {
    const guard = createCp2SystemGuard({
      cp2MeterCheck: vi.fn().mockResolvedValue({
        ok: false,
        result: "invalid",
      }),
      cp2nusMeterCheck: vi.fn().mockResolvedValue({
        ok: true,
        result: "valid",
      }),
    });

    const result = await guard({ txtMtrId: "87654321", txtAmount: "20" });

    expect(result).toMatchObject({
      ok: false,
      code: "WRONG_SYSTEM",
      stage: "meter_system_check",
      error: CP2NUS_ON_CP2_ERROR,
    });
  });

  test("fails open when CP2 check is unavailable", async () => {
    const logger = { warn: vi.fn() };
    const cp2nusMeterCheck = vi.fn();
    const guard = createCp2SystemGuard({
      cp2MeterCheck: vi.fn().mockRejectedValue(new Error("timeout")),
      cp2nusMeterCheck,
      logger,
    });

    await expect(
      guard({ txtMtrId: "12345678", txtAmount: "20" }),
    ).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "cp2_check_failed",
    });
    expect(cp2nusMeterCheck).not.toHaveBeenCalled();
  });

  test("fails open for non-invalid CP2 probe results", async () => {
    const cp2nusMeterCheck = vi.fn();
    const guard = createCp2SystemGuard({
      cp2MeterCheck: vi.fn().mockResolvedValue({
        ok: false,
        result: "http_error",
      }),
      cp2nusMeterCheck,
    });

    await expect(
      guard({ txtMtrId: "12345678", txtAmount: "20" }),
    ).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "cp2_check_http_error",
    });
    expect(cp2nusMeterCheck).not.toHaveBeenCalled();
  });

  test("fails open when CP2NUS check is unavailable", async () => {
    const logger = { warn: vi.fn() };
    const guard = createCp2SystemGuard({
      cp2MeterCheck: vi.fn().mockResolvedValue({
        ok: false,
        result: "invalid",
      }),
      cp2nusMeterCheck: vi.fn().mockRejectedValue(new Error("timeout")),
      logger,
    });

    await expect(
      guard({ txtMtrId: "87654321", txtAmount: "20" }),
    ).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "cp2nus_check_failed",
    });
  });
});
