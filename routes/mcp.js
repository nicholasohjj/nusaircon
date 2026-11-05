const express = require("express");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const meterLookup = require("../services/meterLookup");
const topupAvailability = require("../services/topupAvailability");
const { track, captureException } = require("../services/analytics");
const { createJsonRateLimiter } = require("../services/httpMiddleware");
const { isValidAmount } = require("../services/validators");
const { isValidSutdAmount } = require("../services/sutdService");

// Hosted MCP clients such as Claude connect from shared IP ranges, so this has
// to cover many users behind one address. Only tool calls count towards it.
const TOOL_CALL_LIMIT = 120;
const TOOL_CALL_WINDOW_MS = 5 * 60 * 1000;

const SERVER_INSTRUCTIONS = `Read-only tools for EVS prepaid electricity meters at NUS and SUTD hostels.
Ask for the user's 8-digit meter ID and whether it is an NUS or SUTD meter if you do not know them.
Usage history is available for NUS meters only.
You cannot make payments. To top up, use get_topup_link and give the user the link. Never ask for card details in the conversation.`;

const SYSTEMS = {
  nus: {
    hostel: "cp2nus",
    webappPath: "/cp2nus/webapp",
    isValidAmount,
    amountError: "NUS top-ups must be between $6.00 and $50.00.",
  },
  sutd: {
    hostel: "sutd",
    webappPath: "/sutd/webapp",
    isValidAmount: isValidSutdAmount,
    amountError: "SUTD top-ups must be between $10.00 and $50.00.",
  },
};

const meterIdSchema = z
  .string()
  .regex(/^\d{8}$/, "Meter ID must be exactly 8 digits.")
  .describe("The 8-digit EVS meter ID");
const systemSchema = z
  .enum(["nus", "sutd"])
  .describe("The institution the meter belongs to");

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function getPublicBaseUrl(req) {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

// Picks fields explicitly: the room address stays out of MCP responses because
// they are passed on to the user's AI provider.
async function runLookup(tool, mode, { meter_id: meterId, system }) {
  try {
    const result = await meterLookup.lookupMeter({
      mode,
      meterId,
      hostel: SYSTEMS[system].hostel,
    });
    track("mcp_lookup", { meterId, mode, system, tool });
    return jsonResult({
      meterId,
      system,
      balanceSgd: result.balance,
      checkedAt: result.checkedAt,
      ...(result.usage && { usage: result.usage }),
      ...(result.topups && { topups: result.topups }),
    });
  } catch (err) {
    captureException(err, meterId, { route: "mcp", tool, mode, system });
    return errorResult(
      "Unable to fetch meter details. Check the meter ID and system, then try again.",
    );
  }
}

function buildServer(baseUrl) {
  const server = new McpServer(
    { name: "evs-meter-tools", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "get_meter_balance",
    {
      title: "Get meter balance",
      description: "Get the current prepaid credit balance of a meter, in SGD.",
      inputSchema: { meter_id: meterIdSchema, system: systemSchema },
      annotations: READ_ONLY,
    },
    (args) => runLookup("get_meter_balance", "balance", args),
  );

  server.registerTool(
    "get_meter_usage",
    {
      title: "Get meter usage",
      description:
        "Get the last 7 days of usage for an NUS meter, with spending analysis and month-to-date usage. Not available for SUTD meters.",
      inputSchema: { meter_id: meterIdSchema },
      annotations: READ_ONLY,
    },
    ({ meter_id }) =>
      runLookup("get_meter_usage", "usage", { meter_id, system: "nus" }),
  );

  server.registerTool(
    "get_recent_topups",
    {
      title: "Get recent top-ups",
      description: "Get up to 10 recent top-ups for a meter.",
      inputSchema: { meter_id: meterIdSchema, system: systemSchema },
      annotations: READ_ONLY,
    },
    (args) => runLookup("get_recent_topups", "topups", args),
  );

  server.registerTool(
    "get_topup_link",
    {
      title: "Get top-up link",
      description:
        "Create a link to the secure top-up page, for the user to open and pay by card themselves. Creating the link charges nothing. NUS allows $6-$50 and SUTD allows $10-$50.",
      inputSchema: {
        meter_id: meterIdSchema,
        system: systemSchema,
        amount_sgd: z.number().describe("Top-up amount in SGD"),
      },
      annotations: READ_ONLY,
    },
    ({ meter_id: meterId, system, amount_sgd: amount }) => {
      const config = SYSTEMS[system];
      // Stringified so the check matches what the web route will validate,
      // which rejects amounts with more than two decimal places.
      const txtAmount = String(amount);
      if (!config.isValidAmount(txtAmount)) {
        return errorResult(config.amountError);
      }

      const availability = topupAvailability.getTopupAvailability(system);
      if (availability.disabled) return errorResult(availability.message);

      const qs = new URLSearchParams({ txtMtrId: meterId, txtAmount });
      track("mcp_topup_link_created", { meterId, system, amount });
      return jsonResult({
        url: `${baseUrl}${config.webappPath}?${qs}`,
        meterId,
        system,
        amountSgd: amount,
        note: "The user enters their card details on this page. Check that the page shows the right meter before paying.",
      });
    },
  );

  return server;
}

function jsonRpcError(res, status, code, message) {
  return res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function createMcpRouter({ toolCallLimit = TOOL_CALL_LIMIT } = {}) {
  const router = express.Router();

  const toolCallLimiter = createJsonRateLimiter({
    windowMs: TOOL_CALL_WINDOW_MS,
    limit: toolCallLimit,
    message: "Too many meter requests. Please wait a few minutes and try again.",
  });

  function limitToolCalls(req, res, next) {
    if (req.body?.method !== "tools/call") return next();
    return toolCallLimiter(req, res, next);
  }

  router.post(
    "/",
    express.json({ limit: "16kb" }),
    limitToolCalls,
    async (req, res) => {
      // Stateless: each request gets its own server, so nothing is lost when
      // Railway Serverless sleeps between calls.
      const server = buildServer(getPublicBaseUrl(req));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        captureException(err, "anonymous", { route: "mcp" });
        if (!res.headersSent) {
          jsonRpcError(res, 500, -32603, "Internal server error");
        }
      }
    },
  );

  // Stateless servers offer no SSE stream or session to delete.
  router.all("/", (req, res) => {
    res.set("Allow", "POST");
    return jsonRpcError(res, 405, -32000, "Method not allowed. Use POST.");
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return jsonRpcError(res, 400, -32700, "Parse error");
    }
    if (err.type === "entity.too.large") {
      return jsonRpcError(res, 413, -32600, "Request too large");
    }
    captureException(err, "anonymous", { route: "mcp" });
    return jsonRpcError(res, 500, -32603, "Internal server error");
  });

  return router;
}

module.exports = { createMcpRouter };
