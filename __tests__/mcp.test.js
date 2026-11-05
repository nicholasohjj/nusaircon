import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
process.env.SERVER_URL = "https://meters.example.com/";
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const express = require("express");
const request = require("supertest");
const { app } = require("../server");
const { createMcpRouter } = require("../routes/mcp");
const meterLookup = require("../services/meterLookup");
const topupAvailability = require("../services/topupAvailability");

const ACCEPT = "application/json, text/event-stream";

function makeApp(options) {
  const testApp = express();
  testApp.use("/mcp", createMcpRouter(options));
  return testApp;
}

function rpc(target, method, params) {
  return request(target)
    .post("/mcp")
    .set("Accept", ACCEPT)
    .send({ jsonrpc: "2.0", id: 1, method, params });
}

async function callTool(target, name, args) {
  const res = await rpc(target, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  return res.body.result;
}

describe("MCP endpoint", () => {
  let lookup;

  beforeEach(() => {
    lookup = vi.spyOn(meterLookup, "lookupMeter").mockResolvedValue({
      ok: true,
      mode: "balance",
      meterId: "12345678",
      hostel: "cp2nus",
      address: "Block 1 #01-01",
      balance: 12.5,
      checkedAt: "2026-11-05T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("is mounted on the app and completes the initialize handshake", async () => {
    const res = await rpc(app, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });

    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe("evs-meter-tools");
    expect(res.body.result.instructions).toContain("Never ask for card details");
  });

  test("lists only read-only tools", async () => {
    const res = await rpc(makeApp(), "tools/list", {});
    const { tools } = res.body.result;

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_meter_balance",
      "get_meter_usage",
      "get_recent_topups",
      "get_topup_link",
    ]);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  test("returns the balance without the room address", async () => {
    const result = await callTool(makeApp(), "get_meter_balance", {
      meter_id: "12345678",
      system: "nus",
    });

    expect(lookup).toHaveBeenCalledWith({
      mode: "balance",
      meterId: "12345678",
      hostel: "cp2nus",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      meterId: "12345678",
      system: "nus",
      balanceSgd: 12.5,
      checkedAt: "2026-11-05T00:00:00.000Z",
    });
    expect(result.content[0].text).not.toContain("Block 1");
  });

  test("always looks up usage on the NUS system", async () => {
    await callTool(makeApp(), "get_meter_usage", { meter_id: "12345678" });

    expect(lookup).toHaveBeenCalledWith({
      mode: "usage",
      meterId: "12345678",
      hostel: "cp2nus",
    });
  });

  test("rejects an invalid meter ID before any lookup", async () => {
    const result = await callTool(makeApp(), "get_meter_balance", {
      meter_id: "1234",
      system: "nus",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exactly 8 digits");
    expect(lookup).not.toHaveBeenCalled();
  });

  test("rejects the hidden legacy CP2 system", async () => {
    const result = await callTool(makeApp(), "get_meter_balance", {
      meter_id: "12345678",
      system: "cp2",
    });

    expect(result.isError).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  test("reports a meter with no details as an error", async () => {
    lookup.mockResolvedValue({ address: "", balance: "", checkedAt: "now" });

    const result = await callTool(makeApp(), "get_meter_balance", {
      meter_id: "10010388",
      system: "nus",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("meter ID may be wrong");
  });

  test("hides upstream error details", async () => {
    lookup.mockRejectedValue(new Error("secret upstream detail"));

    const result = await callTool(makeApp(), "get_recent_topups", {
      meter_id: "12345678",
      system: "sutd",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unable to fetch meter details");
    expect(result.content[0].text).not.toContain("secret");
  });

  test.each([
    ["nus", 6, "https://meters.example.com/cp2nus/webapp?txtMtrId=12345678&txtAmount=6"],
    ["sutd", 10.5, "https://meters.example.com/sutd/webapp?txtMtrId=12345678&txtAmount=10.5"],
  ])("builds a %s top-up link", async (system, amount, url) => {
    const result = await callTool(makeApp(), "get_topup_link", {
      meter_id: "12345678",
      system,
      amount_sgd: amount,
    });

    expect(JSON.parse(result.content[0].text).url).toBe(url);
  });

  test.each([
    ["nus", 5.99],
    ["nus", 50.01],
    ["nus", 6.123],
    ["sutd", 9],
  ])("rejects a %s top-up link for $%s", async (system, amount) => {
    const result = await callTool(makeApp(), "get_topup_link", {
      meter_id: "12345678",
      system,
      amount_sgd: amount,
    });

    expect(result.isError).toBe(true);
  });

  test("refuses a top-up link while top-ups are disabled", async () => {
    vi.spyOn(topupAvailability, "getTopupAvailability").mockReturnValue({
      disabled: true,
      message: "Top-ups are paused.",
    });

    const result = await callTool(makeApp(), "get_topup_link", {
      meter_id: "12345678",
      system: "nus",
      amount_sgd: 10,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Top-ups are paused.");
  });

  test("rate limits tool calls but not protocol messages", async () => {
    const testApp = makeApp({ toolCallLimit: 1 });
    const args = { meter_id: "12345678", system: "nus" };
    const call = { name: "get_meter_balance", arguments: args };

    expect((await rpc(testApp, "tools/call", call)).status).toBe(200);
    expect((await rpc(testApp, "tools/call", call)).status).toBe(429);
    expect((await rpc(testApp, "tools/list", {})).status).toBe(200);
  });

  test("answers GET with 405 and malformed JSON with a parse error", async () => {
    const testApp = makeApp();

    const getRes = await request(testApp).get("/mcp");
    expect(getRes.status).toBe(405);
    expect(getRes.headers.allow).toBe("POST");

    const badRes = await request(testApp)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe(-32700);
  });
});
