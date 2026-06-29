import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const request = require("supertest");
const { app } = require("../server");

describe("Swagger docs", () => {
  test("serves the Swagger UI shell without CSP", async () => {
    const res = await request(app).get("/api/").expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.text).toContain('<div id="swagger-ui"></div>');
    expect(res.text).toContain("./swagger-ui-init.js");
  });

  test("serves a no-cache init script that loads the JSON spec", async () => {
    const res = await request(app)
      .get("/api/swagger-ui-init.js")
      .set("If-None-Match", 'W/"stale"')
      .expect(200);

    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers.etag).toBeUndefined();
    expect(res.text).toContain('url: "/api/openapi.json"');
    expect(res.text).toContain("SwaggerUIBundle");
    expect(res.text).not.toContain("window.location.origin");
  });

  test("serves the OpenAPI document as JSON without CSP", async () => {
    const res = await request(app).get("/api/openapi.json").expect(200);

    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info.title).toBe("EVS Meter Tools API");
  });
});
