import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isRailwayRuntime, resolveDbDir } = require("../bot/services/dbDir");

describe("DB directory resolution", () => {
  test("uses project directory when local DB_DIR=/data has no mounted volume", () => {
    expect(
      resolveDbDir({
        env: { DB_DIR: "/data" },
        dataDirExists: false,
      }),
    ).toBe(".");
  });

  test("uses /data when Railway provides DB_DIR=/data", () => {
    expect(
      resolveDbDir({
        env: { DB_DIR: "/data", RAILWAY_ENVIRONMENT: "production" },
        dataDirExists: false,
      }),
    ).toBe("/data");
  });

  test("uses /data by default when the mounted volume exists", () => {
    expect(resolveDbDir({ env: {}, dataDirExists: true })).toBe("/data");
  });

  test("detects Railway runtime variables", () => {
    expect(isRailwayRuntime({ RAILWAY_SERVICE_ID: "svc" })).toBe(true);
    expect(isRailwayRuntime({})).toBe(false);
  });
});
