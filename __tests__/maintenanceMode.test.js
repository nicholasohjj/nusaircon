import { afterEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const originalEnv = { ...process.env };

function loadMaintenanceMode(env = {}) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    ...env,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  return require("../services/maintenanceMode");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("global maintenance mode", () => {
  test("initializes from MAINTENANCE_MODE", () => {
    const { getGlobalMaintenanceStatus } = loadMaintenanceMode({
      MAINTENANCE_MODE: "true",
      GLOBAL_MAINTENANCE: "false",
    });

    expect(getGlobalMaintenanceStatus()).toMatchObject({
      enabled: true,
    });
  });

  test("initializes from GLOBAL_MAINTENANCE alias", () => {
    const { getGlobalMaintenanceStatus } = loadMaintenanceMode({
      MAINTENANCE_MODE: undefined,
      GLOBAL_MAINTENANCE: "true",
    });

    expect(getGlobalMaintenanceStatus()).toMatchObject({
      enabled: true,
    });
  });

  test("returns a 503 page for normal app routes", async () => {
    const express = require("express");
    const request = require("supertest");
    const {
      requireGlobalMaintenanceOff,
      setGlobalMaintenanceEnabled,
    } = loadMaintenanceMode();
    const app = express();

    setGlobalMaintenanceEnabled(true);
    app.use(requireGlobalMaintenanceOff());
    app.get("/app/", (req, res) => res.send("ok"));

    const res = await request(app).get("/app/").expect(503);

    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("service is temporarily unavailable");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  test("returns JSON for API-style routes", async () => {
    const express = require("express");
    const request = require("supertest");
    const {
      requireGlobalMaintenanceOff,
      setGlobalMaintenanceEnabled,
    } = loadMaintenanceMode();
    const app = express();

    setGlobalMaintenanceEnabled(true);
    app.use(requireGlobalMaintenanceOff());
    app.get("/website/lookup", (req, res) => res.json({ ok: true }));

    const res = await request(app).get("/website/lookup").expect(503);

    expect(res.body).toEqual({
      ok: false,
      code: "MAINTENANCE_MODE",
      error:
        "The service is temporarily unavailable while maintenance is in progress. Please try again later.",
    });
  });

  test("allows health checks during maintenance", async () => {
    const express = require("express");
    const request = require("supertest");
    const {
      requireGlobalMaintenanceOff,
      setGlobalMaintenanceEnabled,
    } = loadMaintenanceMode();
    const app = express();

    setGlobalMaintenanceEnabled(true);
    app.use(requireGlobalMaintenanceOff());
    app.get("/health", (req, res) => res.json({ ok: true }));

    const res = await request(app).get("/health").expect(200);

    expect(res.body).toEqual({ ok: true });
  });
});
