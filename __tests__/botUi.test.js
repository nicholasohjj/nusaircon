import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { shortDescription, longDescription } = require("../bot/services/ui");

describe("bot profile descriptions", () => {
  test("stay within Telegram's length limits for both audiences", () => {
    for (const audience of ["nus", "sutd"]) {
      const config = { audience };

      expect(shortDescription(config).length).toBeLessThanOrEqual(120);
      expect(longDescription(config).length).toBeLessThanOrEqual(512);
    }
  });

  test("differ between NUS and SUTD audiences", () => {
    const nus = { audience: "nus" };
    const sutd = { audience: "sutd" };

    expect(shortDescription(nus)).not.toBe(shortDescription(sutd));
    expect(longDescription(nus)).not.toBe(longDescription(sutd));
    expect(longDescription(sutd)).not.toMatch(/PGPR/);
  });
});
