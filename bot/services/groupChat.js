const { Markup } = require("telegraf");
const {
  HOSTELS,
  LOW_BALANCE_THRESHOLD_SGD,
  TOPUP_DISABLED_MESSAGE,
  botOwnedHostels,
} = require("../constants");
const userStore = require("./userStore");
const { handleMeterIdLookup } = require("./lookup");
const { getBotUsername, topupStartUrl } = require("./roommateShare");
const { buildGroupPaidText } = require("./whoPaid");
const { fetchMeterSummary, meterHostel } = require("./inlineCards");
const { track } = require("../../services/analytics");
const { isValidMeterId } = require("../../services/validators");
const { escHtml } = require("../../services/utils");

const GROUP_TYPES = new Set(["group", "supergroup"]);
const PRESENT = new Set(["member", "administrator", "creator", "restricted"]);
const GONE = new Set(["left", "kicked"]);
const THRESHOLD_TEXT = `SGD ${LOW_BALANCE_THRESHOLD_SGD.toFixed(2)}`;

function isGroupChat(ctx) {
  return GROUP_TYPES.has(ctx.chat?.type);
}

/** "/balance@SomeBot 123" → { command, args }, or null if meant for another bot. */
function parseGroupCommand(text, username) {
  const match = String(text || "")
    .trim()
    .match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  if (
    match[2] &&
    username &&
    match[2].toLowerCase() !== username.toLowerCase()
  ) {
    return null;
  }
  return { command: match[1].toLowerCase(), args: (match[3] || "").trim() };
}

function groupIntro(config) {
  const lines = [
    `👋 Hi! I'm the ${config.displayName}.`,
    "",
    "Link this group to your room's meter so everyone here can check it:",
    "<code>/meter 12345678</code>",
    "",
    "Then anyone here can use:",
    "/balance: current balance",
    ...(config.supportsUsage ? ["/usage: last 7 days of usage"] : []),
    "/topups: recent top-ups",
    "/paid: who has topped up this semester",
    "/topup: top up in a private chat with me",
    "",
    `I'll also post here when the balance drops below ${THRESHOLD_TEXT} and before the semester reset. /alerts off stops that.`,
  ];
  return lines.join("\n");
}

function groupMeter(chatId, config, store) {
  return (
    store
      .getSavedMeters(chatId)
      .find((meter) => config.allowedHostels.includes(meter.hostel)) || null
  );
}

const NOT_LINKED_TEXT =
  "This group isn't linked to a meter yet. Send /meter and your 8-digit meter ID, for example <code>/meter 12345678</code>.";

function htmlReply(ctx, text, extra = {}) {
  return ctx.reply(text, { parse_mode: "HTML", ...extra });
}

async function topupMarkup(runtime, meterId) {
  const username = await getBotUsername(runtime.bot);
  if (!username) return null;
  return Markup.inlineKeyboard([
    [
      Markup.button.url(
        "⚡ Top up",
        topupStartUrl(username, runtime.config.audience, meterId, "group"),
      ),
    ],
  ]);
}

async function handleMeterCommand(ctx, args, runtime, deps) {
  const { config } = runtime;
  const { store } = deps;
  const chatId = ctx.chat.id;
  const current = groupMeter(chatId, config, store);

  if (!args) {
    return htmlReply(
      ctx,
      current
        ? `🔗 This group is linked to meter <code>${current.meterId}</code>.\n\n` +
            "To change it, send /meter with the new ID. To unlink, send <code>/meter off</code>."
        : NOT_LINKED_TEXT,
    );
  }

  if (args.toLowerCase() === "off") {
    if (!current) return htmlReply(ctx, NOT_LINKED_TEXT);
    store.forgetUser(chatId, botOwnedHostels(config));
    track("group_meter_unlinked", { chatId, meterId: current.meterId });
    return ctx.reply("🔓 Unlinked. I won't post balance alerts here any more.");
  }

  if (!isValidMeterId(args)) {
    return htmlReply(
      ctx,
      "⚠️ Meter IDs are 8 digits, for example <code>/meter 12345678</code>.",
    );
  }

  const hostel = meterHostel(config);
  let summary;
  try {
    summary = await deps.fetchSummary(args, hostel);
  } catch {
    return htmlReply(
      ctx,
      `⚠️ I couldn't look up meter <code>${args}</code>. Check the number and try again.`,
    );
  }

  store.setGroupMeter(chatId, args, hostel, botOwnedHostels(config));
  track("group_meter_linked", {
    chatId,
    meterId: args,
    hostel,
    replaced: Boolean(current && current.meterId !== args),
  });

  const balance = Number(summary?.credit_bal);
  const lines = [`🔗 This group is now linked to meter <code>${args}</code>.`];
  if (summary?.address) lines.push(`🏠 ${escHtml(summary.address)}`);
  if (summary?.credit_bal != null && Number.isFinite(balance)) {
    lines.push(`💰 Balance: SGD ${balance.toFixed(2)}`);
  }
  lines.push(
    "",
    `Anyone here can now use /balance${config.supportsUsage ? ", /usage" : ""}, /topups and /paid. ` +
      `I'll post here when the balance drops below ${THRESHOLD_TEXT} and before the semester reset. /alerts off stops that.`,
  );
  const markup = await topupMarkup(runtime, args);
  return htmlReply(ctx, lines.join("\n"), markup || {});
}

async function handleLookupCommand(ctx, mode, runtime, deps) {
  const { config } = runtime;
  if (mode === "usage" && !config.supportsUsage) {
    return ctx.reply("⚠️ Usage history is not available for SUTD yet.");
  }
  const meter = groupMeter(ctx.chat.id, config, deps.store);
  if (!meter) return htmlReply(ctx, NOT_LINKED_TEXT);

  track("group_lookup", { chatId: ctx.chat.id, mode, meterId: meter.meterId });
  const markup = await topupMarkup(runtime, meter.meterId);
  return deps.lookup(ctx, ctx.chat.id, meter.meterId, mode, {
    hostel: meter.hostel === HOSTELS.CP2 ? HOSTELS.CP2NUS : meter.hostel,
    config,
    followUp: false,
    replyMarkup: markup?.reply_markup || null,
  });
}

async function handleTopupCommand(ctx, runtime, deps) {
  const { config, state } = runtime;
  if (state?.topupDisabled) return ctx.reply(TOPUP_DISABLED_MESSAGE);

  const meter = groupMeter(ctx.chat.id, config, deps.store);
  if (!meter) return htmlReply(ctx, NOT_LINKED_TEXT);

  track("group_topup_command", { chatId: ctx.chat.id, meterId: meter.meterId });
  const markup = await topupMarkup(runtime, meter.meterId);
  return htmlReply(
    ctx,
    `Top-ups happen in a private chat with me. Tap below to top up meter <code>${meter.meterId}</code>.`,
    markup || {},
  );
}

function handleAlertsCommand(ctx, args, runtime, deps) {
  const { config } = runtime;
  const meter = groupMeter(ctx.chat.id, config, deps.store);
  if (!meter) return htmlReply(ctx, NOT_LINKED_TEXT);

  const action = args.toLowerCase();
  if (action === "on" || action === "off") {
    const enabled = action === "on";
    deps.store.setLowBalanceAlerts(
      ctx.chat.id,
      botOwnedHostels(config),
      enabled,
    );
    track("low_balance_alerts_changed", {
      chatId: ctx.chat.id,
      enabled,
      group: true,
    });
    return ctx.reply(
      enabled
        ? `🔔 Alerts are on. I'll post here when the balance drops below ${THRESHOLD_TEXT} and before the semester reset.`
        : "🔕 Alerts are off for this group.",
    );
  }

  return ctx.reply(
    `${meter.lowBalanceAlerts ? "🔔 Alerts are on" : "🔕 Alerts are off"} for this group. ` +
      "Use /alerts on or /alerts off to change this.",
  );
}

async function handlePaidCommand(ctx, runtime, deps) {
  const meter = groupMeter(ctx.chat.id, runtime.config, deps.store);
  if (!meter) return htmlReply(ctx, NOT_LINKED_TEXT);
  track("paid_command", { chatId: ctx.chat.id, group: true });
  return htmlReply(
    ctx,
    await buildGroupPaidText(ctx, meter, runtime.config, { store: deps.store }),
  );
}

async function handleMembership(ctx, runtime, deps) {
  const update = ctx.myChatMember;
  const before = update?.old_chat_member?.status;
  const after = update?.new_chat_member?.status;
  const chatId = ctx.chat.id;

  if (GONE.has(after)) {
    deps.store.forgetUser(chatId, botOwnedHostels(runtime.config));
    track("group_removed", { chatId });
    return;
  }
  if (PRESENT.has(after) && (!before || GONE.has(before))) {
    track("group_added", { chatId });
    return htmlReply(ctx, groupIntro(runtime.config));
  }
}

/**
 * Handles every update from group chats and stops it there, so the private
 * flows (sessions, reply keyboards, payment buttons) never run in a group.
 */
async function handleGroupUpdate(ctx, runtime, deps) {
  if (ctx.myChatMember) return handleMembership(ctx, runtime, deps);

  const migrateTo = ctx.message?.migrate_to_chat_id;
  if (migrateTo) {
    deps.store.moveChat(ctx.chat.id, migrateTo);
    return;
  }

  if (ctx.callbackQuery) {
    return ctx
      .answerCbQuery("Open a private chat with me to do that.")
      .catch(() => {});
  }

  const username = ctx.botInfo?.username || (await getBotUsername(runtime.bot));
  const parsed = parseGroupCommand(ctx.message?.text, username);
  if (!parsed) return;
  const { command, args } = parsed;

  switch (command) {
    case "start":
    case "help":
      return htmlReply(ctx, groupIntro(runtime.config));
    case "meter":
      return handleMeterCommand(ctx, args, runtime, deps);
    case "balance":
    case "usage":
    case "topups":
      return handleLookupCommand(ctx, command, runtime, deps);
    case "topup":
      return handleTopupCommand(ctx, runtime, deps);
    case "alerts":
      return handleAlertsCommand(ctx, args, runtime, deps);
    case "paid":
      return handlePaidCommand(ctx, runtime, deps);
    default:
      return;
  }
}

function createGroupGuard(runtime, deps = {}) {
  const resolved = {
    store: userStore,
    fetchSummary: fetchMeterSummary,
    lookup: handleMeterIdLookup,
    ...deps,
  };
  return async (ctx, next) => {
    const type = ctx.chat?.type;
    if (!type || type === "private") return next();
    // Channels and anything else: ignore.
    if (!GROUP_TYPES.has(type)) return;
    return handleGroupUpdate(ctx, runtime, resolved);
  };
}

function registerGroupChat(bot, runtime) {
  bot.use(createGroupGuard({ ...runtime, bot }));
}

const GROUP_COMMANDS = [
  { command: "meter", description: "Link this group to your room's meter" },
  { command: "balance", description: "Check the room's balance" },
  { command: "usage", description: "Show recent daily usage" },
  { command: "topups", description: "Show recent top-ups" },
  { command: "paid", description: "Who has topped up this semester" },
  { command: "topup", description: "Top up in a private chat" },
  { command: "alerts", description: "Turn balance alerts on or off" },
  { command: "help", description: "How to use me in a group" },
];

function groupCommands(config) {
  return GROUP_COMMANDS.filter(
    (entry) => entry.command !== "usage" || config.supportsUsage,
  );
}

module.exports = {
  createGroupGuard,
  groupCommands,
  groupIntro,
  isGroupChat,
  parseGroupCommand,
  registerGroupChat,
};
