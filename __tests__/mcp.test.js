import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:test";
process.env.TELEGRAM_BOT_MODE = "polling";
process.env.SERVER_URL = "https://meters.example.com/";
delete process.env.POSTHOG_API_KEY;

const require = createRequire(import.meta.url);
const axios = require("axios");
const express = require("express");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const request = require("supertest");
const { app } = require("../server");
const { createMcpRouter } = require("../routes/mcp");
const meterLookup = require("../services/meterLookup");
const { isSutdLoginRejected } = require("../services/sutdService");
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
  let meterStatus;

  const parseError = (result) => {
    expect(result.isError).toBe(true);
    return JSON.parse(result.content[0].text);
  };

  beforeEach(() => {
    meterStatus = vi
      .spyOn(meterLookup, "getMeterStatus")
      .mockResolvedValue("found");
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
    expect(res.body.result.instructions).toContain(
      "Never ask for card details",
    );
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

  describe("structured output", () => {
    const usageResult = {
      address: "Block 1 #01-01",
      balance: "13.62000000",
      checkedAt: "now",
      usage: {
        days: 7,
        history: [{ date: "2026-11-03T23:30:38", amount: 1.64 }],
        analysis: {
          avgDaily: 1.64,
          total: 1.64,
          lastDay: 1.64,
          zeroStreak: 0,
          spike: null,
          warnings: [],
        },
        rank: { rank_val: "0.3" },
        monthToDate: -7.44,
      },
    };
    const topupsResult = (history) => ({
      address: "Block 1 #01-01",
      balance: 5,
      checkedAt: "now",
      topups: { lookbackDays: null, source: "sutd", history },
    });
    let server;
    let client;

    // The SDK client checks every response against the tool's output schema,
    // the way a real agent's client does.
    beforeEach(async () => {
      server = await new Promise((resolve) => {
        const listening = makeApp().listen(0, () => resolve(listening));
      });
      client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${server.address().port}/mcp`),
        ),
      );
      await client.listTools();
    });

    afterEach(async () => {
      await client.close();
      await new Promise((resolve) => server.close(resolve));
    });

    test("every tool declares an output schema", async () => {
      const { tools } = await client.listTools();

      expect(tools.every((tool) => tool.outputSchema)).toBe(true);
    });

    test.each([
      ["get_meter_balance", { meter_id: "12345678", system: "nus" }],
      ["get_meter_usage", { meter_id: "12345678" }],
      ["get_recent_topups", { meter_id: "12345678", system: "sutd" }],
      [
        "get_topup_link",
        { meter_id: "12345678", system: "nus", amount_sgd: 10 },
      ],
    ])(
      "%s returns the same data as text and typed fields",
      async (name, args) => {
        lookup.mockResolvedValue(
          name === "get_meter_usage"
            ? usageResult
            : name === "get_recent_topups"
              ? topupsResult([])
              : { address: "x", balance: 5, checkedAt: "now" },
        );

        const result = await client.callTool({ name, arguments: args });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toBeTruthy();
        expect(JSON.parse(result.content[0].text)).toEqual(
          result.structuredContent,
        );
      },
    );

    test("leaves structured output off errors", async () => {
      meterStatus.mockResolvedValue("not_found");

      const result = await client.callTool({
        name: "get_topup_link",
        arguments: { meter_id: "12345678", system: "nus", amount_sgd: 10 },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });

    test("includes when the link was made", async () => {
      const before = Date.now();

      const { structuredContent } = await client.callTool({
        name: "get_topup_link",
        arguments: { meter_id: "12345678", system: "nus", amount_sgd: 10 },
      });

      expect(Date.parse(structuredContent.createdAt)).toBeGreaterThanOrEqual(
        before,
      );
    });

    test("keeps a top-up status only when EVS gives one", async () => {
      lookup.mockResolvedValue(
        topupsResult([
          {
            date: "2026-11-03 20:09:42",
            amount: 20,
            reference: "nus-style",
            status: "",
          },
          {
            date: "03/11/2026 20:09",
            amount: 10,
            reference: "sutd-style",
            status: "Yes",
          },
        ]),
      );

      const { structuredContent } = await client.callTool({
        name: "get_recent_topups",
        arguments: { meter_id: "12345678", system: "sutd" },
      });

      expect(structuredContent.topups.history).toEqual([
        {
          date: "2026-11-03 20:09:42",
          amountSgd: 20,
          reference: "nus-style",
        },
        {
          date: "03/11/2026 20:09",
          amountSgd: 10,
          reference: "sutd-style",
          status: "Yes",
        },
      ]);
    });
  });

  test("tells agents how to confirm a payment", async () => {
    const res = await rpc(makeApp(), "tools/list", {});
    const { description } = res.body.result.tools.find(
      (tool) => tool.name === "get_recent_topups",
    );

    expect(description).toContain("createdAt");
    expect(description).toContain("before paying again");
  });

  test("always looks up usage on the NUS system", async () => {
    await callTool(makeApp(), "get_meter_usage", { meter_id: "12345678" });

    expect(lookup).toHaveBeenCalledWith({
      mode: "usage",
      meterId: "12345678",
      hostel: "cp2nus",
    });
  });

  describe("usage values", () => {
    const usage = {
      days: 7,
      history: [
        { date: "2026-11-03T23:30:38", amount: 1.6429999999999154 },
        { date: "2026-11-02T23:30:39", amount: 0 },
        { date: "2026-11-01T23:30:37", amount: null },
      ],
      analysis: {
        avgDaily: 0.8214999999999577,
        total: 1.6429999999999154,
        lastDay: 1.6429999999999154,
        zeroStreak: 0,
        spike: {
          lastDay: 1.6429999999999154,
          avgDaily: 0.8214999999999577,
          factor: 2.04,
        },
        warnings: [],
      },
      rank: null,
      monthToDate: -7.44,
    };

    async function getUsage(overrides = {}) {
      lookup.mockResolvedValue({
        address: "Block 1 #01-01",
        balance: "13.62000000",
        checkedAt: "now",
        usage,
        ...overrides,
      });
      const result = await callTool(makeApp(), "get_meter_usage", {
        meter_id: "12345678",
      });
      return JSON.parse(result.content[0].text);
    }

    test("returns rounded SGD values and how much data came back", async () => {
      const body = await getUsage();

      expect(body.balanceSgd).toBe(13.62);
      expect(body.usage).toEqual({
        requestedDays: 7,
        daysWithData: 2,
        history: [
          { date: "2026-11-03T23:30:38", amountSgd: 1.64 },
          { date: "2026-11-02T23:30:39", amountSgd: 0 },
          { date: "2026-11-01T23:30:37", amountSgd: null },
        ],
        analysis: {
          avgDailySgd: 0.82,
          totalSgd: 1.64,
          lastDaySgd: 1.64,
          zeroStreak: 0,
          spike: { lastDaySgd: 1.64, avgDailySgd: 0.82, factor: 2 },
          warnings: [],
        },
        estimatedDaysLeft: 16.6,
        rank: null,
        monthToDateSgd: 7.44,
      });
    });

    test.each([
      ["a blank balance", { balance: "" }, null],
      ["a negative balance", { balance: "-2" }, 0],
      [
        "no recent usage",
        {
          usage: {
            ...usage,
            analysis: { ...usage.analysis, avgDaily: 0, spike: null },
          },
        },
        null,
      ],
    ])("estimates days left with %s", async (_name, overrides, expected) => {
      const body = await getUsage(overrides);

      expect(body.usage.estimatedDaysLeft).toBe(expected);
    });

    test("does not turn missing values into zero", async () => {
      const body = await getUsage({
        balance: "",
        usage: {
          ...usage,
          analysis: { ...usage.analysis, avgDaily: null, spike: null },
          monthToDate: null,
        },
      });

      expect(body.balanceSgd).toBeNull();
      expect(body.usage.analysis.avgDailySgd).toBeNull();
      expect(body.usage.monthToDateSgd).toBeNull();
    });
  });

  test("reads the date from an EVS usage record", () => {
    expect(
      meterLookup.normalizeUsageRecord({
        reading_timestamp: "2026-11-03T23:30:38",
        reading_diff: 1.5,
      }),
    ).toEqual({ date: "2026-11-03T23:30:38", amount: 1.5 });
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

  test.each([
    ["not_found", "METER_NOT_FOUND", false],
    ["unavailable", "EVS_UNAVAILABLE", true],
    ["found", "EVS_UNAVAILABLE", true],
  ])(
    "reports blank details when the meter status is %s as %s",
    async (status, code, retryable) => {
      lookup.mockResolvedValue({ address: "", balance: "", checkedAt: "now" });
      meterStatus.mockResolvedValue(status);

      const result = await callTool(makeApp(), "get_meter_balance", {
        meter_id: "10010388",
        system: "nus",
      });

      expect(parseError(result)).toMatchObject({ code, retryable });
      expect(meterStatus).toHaveBeenCalledWith({
        meterId: "10010388",
        hostel: "cp2nus",
      });
    },
  );

  test("treats a rejected SUTD login as an unknown meter", async () => {
    lookup.mockRejectedValue(
      Object.assign(new Error("SUTD login invalid"), {
        code: "METER_NOT_FOUND",
      }),
    );

    const result = await callTool(makeApp(), "get_recent_topups", {
      meter_id: "12345678",
      system: "sutd",
    });

    expect(parseError(result).code).toBe("METER_NOT_FOUND");
    expect(parseError(result).message).toContain("SUTD");
    expect(meterStatus).not.toHaveBeenCalled();
  });

  test("reports an unknown meter when a lookup throws", async () => {
    lookup.mockRejectedValue(new Error("get_history failed with HTTP 500"));
    meterStatus.mockResolvedValue("not_found");

    const result = await callTool(makeApp(), "get_meter_usage", {
      meter_id: "12345678",
    });

    expect(parseError(result).code).toBe("METER_NOT_FOUND");
  });

  test("hides upstream error details", async () => {
    lookup.mockRejectedValue(new Error("secret upstream detail"));

    const result = await callTool(makeApp(), "get_recent_topups", {
      meter_id: "12345678",
      system: "sutd",
    });

    expect(parseError(result)).toMatchObject({
      code: "EVS_UNAVAILABLE",
      retryable: true,
    });
    expect(result.content[0].text).not.toContain("secret");
  });

  describe("top-up link meter check", () => {
    const args = { meter_id: "12345678", system: "nus", amount_sgd: 10 };

    test("refuses a meter EVS does not recognise", async () => {
      meterStatus.mockResolvedValue("not_found");

      const result = await callTool(makeApp(), "get_topup_link", args);

      expect(parseError(result)).toMatchObject({
        code: "METER_NOT_FOUND",
        retryable: false,
      });
      expect(result.content[0].text).not.toContain("webapp");
    });

    test.each([
      ["found", true],
      ["unavailable", false],
    ])("with status %s has meterVerified %s", async (status, verified) => {
      meterStatus.mockResolvedValue(status);

      const result = await callTool(makeApp(), "get_topup_link", args);
      const body = JSON.parse(result.content[0].text);

      expect(body.meterVerified).toBe(verified);
      expect(body.url).toContain("txtMtrId=12345678");
    });

    test("checks the SUTD system for a SUTD meter", async () => {
      await callTool(makeApp(), "get_topup_link", {
        ...args,
        system: "sutd",
      });

      expect(meterStatus).toHaveBeenCalledWith({
        meterId: "12345678",
        hostel: "sutd",
      });
    });

    test("does not call EVS for an amount it would reject", async () => {
      const result = await callTool(makeApp(), "get_topup_link", {
        ...args,
        amount_sgd: 1,
      });

      expect(parseError(result).code).toBe("INVALID_AMOUNT");
      expect(meterStatus).not.toHaveBeenCalled();
    });
  });

  describe("getMeterStatus on the NUS system", () => {
    test.each([
      ["a balance", { status: 200, data: { ref_bal: 1 } }, "found"],
      [
        "EVS's not found reply",
        { status: 404, data: { info: "Meter displayname not found" } },
        "not_found",
      ],
      ["a 404 from elsewhere", { status: 404, data: "<html>" }, "unavailable"],
      ["a server error", { status: 500, data: {} }, "unavailable"],
    ])("reads %s", async (_name, response, expected) => {
      meterStatus.mockRestore();
      vi.spyOn(axios, "post").mockResolvedValue(response);

      expect(
        await meterLookup.getMeterStatus({
          meterId: "12345678",
          hostel: "cp2nus",
        }),
      ).toBe(expected);
    });

    test("reads a network failure as unavailable", async () => {
      meterStatus.mockRestore();
      vi.spyOn(axios, "post").mockRejectedValue(new Error("timeout"));

      expect(
        await meterLookup.getMeterStatus({
          meterId: "12345678",
          hostel: "cp2nus",
        }),
      ).toBe("unavailable");
    });
  });

  test.each([
    [
      302,
      { location: "/SUTD/index.jsp?strMsg=Invalid Login ID or Password." },
      "",
      true,
    ],
    [
      302,
      { location: "/SUTD/index.jsp?strMsg=Invalid%20Login%20ID" },
      "",
      true,
    ],
    [302, { location: "/SUTD/maintenance.jsp" }, "", false],
    [200, {}, "Invalid Login ID or Password", true],
    [200, {}, "<title>EVS-SUTD</title>", false],
    [500, {}, "", false],
  ])(
    "reads SUTD login response %s %j as rejected: %s %s",
    (status, headers, data, expected) => {
      expect(isSutdLoginRejected({ status, headers, data })).toBe(expected);
    },
  );

  test.each([
    [
      "nus",
      6,
      "https://meters.example.com/cp2nus/webapp?txtMtrId=12345678&txtAmount=6",
    ],
    [
      "sutd",
      10.5,
      "https://meters.example.com/sutd/webapp?txtMtrId=12345678&txtAmount=10.5",
    ],
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

    expect(parseError(result)).toMatchObject({
      code: "TOPUPS_PAUSED",
      message: "Top-ups are paused.",
    });
  });

  test("rate limits tool calls as a tool error, but not protocol messages", async () => {
    const testApp = makeApp({ toolCallLimit: 1 });
    const args = { meter_id: "12345678", system: "nus" };
    const call = { name: "get_meter_balance", arguments: args };

    expect((await rpc(testApp, "tools/call", call)).status).toBe(200);

    const limited = await rpc(testApp, "tools/call", call);
    expect(limited.status).toBe(200);
    expect(limited.body.id).toBe(1);
    const error = parseError(limited.body.result);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(lookup).toHaveBeenCalledTimes(1);

    expect((await rpc(testApp, "tools/list", {})).status).toBe(200);
  });

  test("rejects batched tool calls so they can't skip the limit", async () => {
    const call = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "get_meter_balance",
        arguments: { meter_id: "12345678", system: "nus" },
      },
    };

    const res = await request(makeApp({ toolCallLimit: 1 }))
      .post("/mcp")
      .set("Accept", ACCEPT)
      .send([
        { ...call, id: 1 },
        { ...call, id: 2 },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
    expect(lookup).not.toHaveBeenCalled();
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
