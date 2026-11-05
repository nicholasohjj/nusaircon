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
You cannot make payments. To top up, use get_topup_link and give the user the link. Never ask for card details in the conversation.
Errors are JSON with a code, a message, and whether retrying can help. If retryable is false, ask the user instead of calling again.
To confirm a payment, follow the steps in get_recent_topups. Never tell the user to pay again just because a top-up has not appeared yet.`;

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

const lookupOutput = {
  meterId: z.string(),
  system: systemSchema,
  balanceSgd: z.number().nullable(),
  checkedAt: z.string().describe("When this was checked, as an ISO 8601 time"),
};

const usageOutput = z.object({
  requestedDays: z.number(),
  daysWithData: z
    .number()
    .describe(
      "How many days the averages are based on. Can be under requestedDays.",
    ),
  history: z.array(
    z.object({
      date: z.string(),
      amountSgd: z.number().nullable(),
    }),
  ),
  analysis: z.object({
    avgDailySgd: z.number().nullable(),
    totalSgd: z.number().nullable(),
    lastDaySgd: z.number().nullable(),
    zeroStreak: z.number(),
    spike: z
      .object({
        lastDaySgd: z.number().nullable(),
        avgDailySgd: z.number().nullable(),
        factor: z.number(),
      })
      .nullable(),
    warnings: z.array(z.string()),
  }),
  estimatedDaysLeft: z
    .number()
    .nullable()
    .describe("Balance divided by average daily spending. Null if unknown."),
  rank: z.record(z.string(), z.unknown()).nullable(),
  monthToDateSgd: z.number().nullable(),
});

const topupsOutput = z.object({
  lookbackDays: z.number().nullable(),
  source: z.string(),
  history: z.array(
    z.object({
      date: z.string(),
      amountSgd: z.number().nullable(),
      reference: z.string(),
      status: z
        .string()
        .optional()
        .describe("EVS's status for this top-up, when it gives one"),
    }),
  ),
});

const topupLinkOutput = {
  url: z.string(),
  meterId: z.string(),
  system: systemSchema,
  amountSgd: z.number(),
  meterVerified: z.boolean(),
  createdAt: z
    .string()
    .describe(
      "When the link was made, as an ISO 8601 time. Used to confirm a payment.",
    ),
  note: z.string(),
};

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function errorResult(code, message, { retryable = false, ...details } = {}) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ code, message, retryable, ...details }),
      },
    ],
    isError: true,
  };
}

function meterNotFoundResult(system) {
  return errorResult(
    "METER_NOT_FOUND",
    `EVS has no ${system.toUpperCase()} meter with this ID. Check the 8-digit ID, and whether the meter is NUS or SUTD, with the user.`,
  );
}

function evsUnavailableResult() {
  return errorResult(
    "EVS_UNAVAILABLE",
    "EVS could not be reached or returned no details. Try again in a few minutes.",
    { retryable: true },
  );
}

function getPublicBaseUrl(req) {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

function toSgd(value) {
  // Number("") and Number(null) are 0, which would read as an empty meter.
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function estimateDaysLeft(balanceSgd, avgDailySgd) {
  if (balanceSgd === null || !(avgDailySgd > 0)) return null;
  return Math.max(0, Math.round((balanceSgd / avgDailySgd) * 10) / 10);
}

function formatUsage(
  { days, history, analysis, rank, monthToDate },
  balanceSgd,
) {
  const monthToDateSgd = toSgd(monthToDate);
  return {
    requestedDays: days,
    // EVS can return fewer readings than requested, and the averages use only
    // the readings that came back.
    daysWithData: history.filter(({ amount }) => amount !== null && amount >= 0)
      .length,
    history: history.map(({ date, amount }) => ({
      date: String(date),
      amountSgd: toSgd(amount),
    })),
    analysis: {
      avgDailySgd: toSgd(analysis.avgDaily),
      totalSgd: toSgd(analysis.total),
      lastDaySgd: toSgd(analysis.lastDay),
      zeroStreak: analysis.zeroStreak,
      spike: analysis.spike && {
        lastDaySgd: toSgd(analysis.spike.lastDay),
        avgDailySgd: toSgd(analysis.spike.avgDaily),
        factor: Math.round(analysis.spike.factor * 10) / 10,
      },
      warnings: analysis.warnings,
    },
    estimatedDaysLeft: estimateDaysLeft(balanceSgd, analysis.avgDaily),
    rank,
    // EVS reports this as a negative number. It is the amount spent.
    monthToDateSgd: monthToDateSgd === null ? null : Math.abs(monthToDateSgd),
  };
}

function formatTopups({ lookbackDays, source, history }) {
  return {
    lookbackDays,
    source: String(source),
    history: history.map(({ date, amount, reference, status }) => ({
      date: String(date),
      amountSgd: toSgd(amount),
      reference: String(reference),
      // NUS leaves this blank, but SUTD can use it to mark a failed payment.
      ...(status && { status: String(status) }),
    })),
  };
}

// Picks fields explicitly: the room address stays out of MCP responses because
// they are passed on to the user's AI provider.
async function runLookup(tool, mode, { meter_id: meterId, system }) {
  const { hostel } = SYSTEMS[system];
  try {
    const result = await meterLookup.lookupMeter({ mode, meterId, hostel });
    // getMeterSummary reports a missing meter and a failed request the same
    // way, by returning blank fields, so this asks EVS which one it was.
    if (result.balance === "" && !result.address) {
      const status = await meterLookup.getMeterStatus({ meterId, hostel });
      return status === "not_found"
        ? meterNotFoundResult(system)
        : evsUnavailableResult();
    }
    track("mcp_lookup", { meterId, mode, system, tool });
    const balanceSgd = toSgd(result.balance);
    return jsonResult({
      meterId,
      system,
      balanceSgd,
      checkedAt: result.checkedAt,
      ...(result.usage && { usage: formatUsage(result.usage, balanceSgd) }),
      ...(result.topups && { topups: formatTopups(result.topups) }),
    });
  } catch (err) {
    // Usage history can fail for an unknown meter even after a blank summary.
    const status =
      err.code === "METER_NOT_FOUND"
        ? "not_found"
        : await meterLookup.getMeterStatus({ meterId, hostel });
    if (status === "not_found") return meterNotFoundResult(system);

    captureException(err, meterId, { route: "mcp", tool, mode, system });
    return evsUnavailableResult();
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
      outputSchema: lookupOutput,
      annotations: READ_ONLY,
    },
    (args) => runLookup("get_meter_balance", "balance", args),
  );

  server.registerTool(
    "get_meter_usage",
    {
      title: "Get meter usage",
      description:
        "Get up to 7 days of usage for an NUS meter, with spending analysis, month-to-date spending, and how long the balance may last. Amounts are in SGD. Dates are as EVS reports them, with no time zone, and recent days may be missing. Not available for SUTD meters.",
      inputSchema: { meter_id: meterIdSchema },
      outputSchema: { ...lookupOutput, usage: usageOutput },
      annotations: READ_ONLY,
    },
    ({ meter_id }) =>
      runLookup("get_meter_usage", "usage", { meter_id, system: "nus" }),
  );

  server.registerTool(
    "get_recent_topups",
    {
      title: "Get recent top-ups",
      description:
        "Get up to 10 recent top-ups for a meter. To confirm a payment, look for a top-up with the same amount dated after the createdAt of its link, and with no status showing it failed. Earlier top-ups can have the same amount, so always check the date. Dates have no time zone and appear to be Singapore time (UTC+8), while createdAt is ISO 8601. If nothing matches, the payment may not be recorded yet or may have failed: check again later, and have the user check their card statement before paying again.",
      inputSchema: { meter_id: meterIdSchema, system: systemSchema },
      outputSchema: { ...lookupOutput, topups: topupsOutput },
      annotations: READ_ONLY,
    },
    (args) => runLookup("get_recent_topups", "topups", args),
  );

  server.registerTool(
    "get_topup_link",
    {
      title: "Get top-up link",
      description:
        "Create a link to the secure top-up page, for the user to open and pay by card themselves. Creating the link charges nothing. Refuses a meter EVS doesn't recognise. If EVS can't be reached, meterVerified is false, so ask the user to check the meter on the page. NUS allows $6-$50 and SUTD allows $10-$50.",
      inputSchema: {
        meter_id: meterIdSchema,
        system: systemSchema,
        amount_sgd: z.number().describe("Top-up amount in SGD"),
      },
      outputSchema: topupLinkOutput,
      annotations: READ_ONLY,
    },
    async ({ meter_id: meterId, system, amount_sgd: amount }) => {
      const config = SYSTEMS[system];
      // Stringified so the check matches what the web route will validate,
      // which rejects amounts with more than two decimal places.
      const txtAmount = String(amount);
      if (!config.isValidAmount(txtAmount)) {
        return errorResult("INVALID_AMOUNT", config.amountError);
      }

      const availability = topupAvailability.getTopupAvailability(system);
      if (availability.disabled) {
        return errorResult("TOPUPS_PAUSED", availability.message);
      }

      // An outage doesn't block the link: the page stops by itself if EVS is
      // still down, and the page shows the meter for the user to check.
      const status = await meterLookup.getMeterStatus({
        meterId,
        hostel: config.hostel,
      });
      if (status === "not_found") return meterNotFoundResult(system);

      const qs = new URLSearchParams({ txtMtrId: meterId, txtAmount });
      track("mcp_topup_link_created", { meterId, system, amount, status });
      return jsonResult({
        url: `${baseUrl}${config.webappPath}?${qs}`,
        meterId,
        system,
        amountSgd: amount,
        meterVerified: status === "found",
        createdAt: new Date().toISOString(),
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
    message:
      "Too many meter requests. Please wait a few minutes and try again.",
    // A tool error reaches the agent. Some clients show an HTTP 429 as a
    // connection failure instead.
    handler: (req, res, next, options) => {
      const resetTime = req.rateLimit?.resetTime;
      return res.json({
        jsonrpc: "2.0",
        id: req.body.id ?? null,
        result: errorResult("RATE_LIMITED", options.message.error, {
          retryable: true,
          ...(resetTime && {
            retryAfterSeconds: Math.ceil((resetTime - Date.now()) / 1000),
          }),
        }),
      });
    },
  });

  function limitToolCalls(req, res, next) {
    // A batch would otherwise run many tool calls for one check of the limit.
    if (
      Array.isArray(req.body) &&
      req.body.some((message) => message?.method === "tools/call")
    ) {
      return jsonRpcError(
        res,
        400,
        -32600,
        "Batched tool calls are not supported. Send them one at a time.",
      );
    }
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
