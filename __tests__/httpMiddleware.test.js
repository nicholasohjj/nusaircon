import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const express = require("express");
const request = require("supertest");
const {
  createJsonRateLimiter,
  sanitizeRequestUrl,
  securityHeaders,
} = require("../services/httpMiddleware");

describe("http middleware", () => {
  test("sets security headers for app routes", async () => {
    const app = express();
    app.use(securityHeaders);
    app.get("/app/", (req, res) => res.send("ok"));

    const res = await request(app).get("/app/").expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    );
    expect(res.headers["content-security-policy"]).toContain(
      "script-src 'self' https://telegram.org https://www.enets.sg",
    );
  });

  test("keeps CSP disabled for Swagger routes", async () => {
    const app = express();
    app.use(securityHeaders);
    app.get("/api", (req, res) => res.send("ok"));

    const res = await request(app).get("/api").expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  test("redacts sensitive query params from log URLs", () => {
    expect(
      sanitizeRequestUrl(
        "/webapp/session?token=secret&restartUrl=%2Fwebapp%3Ftoken%3Dx&txtAmount=20",
      ),
    ).toBe(
      "/webapp/session?token=%5Bredacted%5D&restartUrl=%5Bredacted%5D&txtAmount=20",
    );
  });

  test("returns JSON rate-limit responses", async () => {
    const app = express();
    app.use(
      "/limited",
      createJsonRateLimiter({
        windowMs: 60 * 1000,
        limit: 1,
        message: "Slow down.",
      }),
    );
    app.get("/limited", (req, res) => res.json({ ok: true }));

    await request(app).get("/limited").expect(200);
    const res = await request(app).get("/limited").expect(429);

    expect(res.body).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      error: "Slow down.",
    });
    expect(res.headers.ratelimit).toBeTruthy();
  });
});
