const { Markup } = require("telegraf");

// Added to the deep link so /start can tell a roommate share apart from other
// links that carry a meter ID.
const SHARE_SUFFIX = "share";

const SHARE_TEXT =
  "Top up our room's aircon credit in Telegram. The meter is already filled in:";

const usernames = new WeakMap();

/** The bot's @username, or null if Telegram can't be reached. */
async function getBotUsername(bot) {
  const known = bot?.botInfo?.username || usernames.get(bot);
  if (known) return known;
  try {
    const me = await bot.telegram.getMe();
    if (!me?.username) return null;
    usernames.set(bot, me.username);
    return me.username;
  } catch {
    return null;
  }
}

function shareStartPayload(audience, meterId) {
  const prefix = audience === "sutd" ? "sutd" : "nus";
  return `${prefix}_${meterId}_${SHARE_SUFFIX}`;
}

function buildShareUrl(username, audience, meterId) {
  const deepLink = `https://t.me/${username}?start=${shareStartPayload(audience, meterId)}`;
  const params = new URLSearchParams({ url: deepLink, text: SHARE_TEXT });
  return `https://t.me/share/url?${params.toString()}`;
}

/**
 * Inline keyboard that lets someone send their roommates a link which opens
 * the bot with this meter ready to top up. Null if the link can't be built.
 */
async function roommateShareKeyboard(bot, audience, meterId) {
  if (!/^\d{8}$/.test(String(meterId || ""))) return null;
  const username = await getBotUsername(bot);
  if (!username) return null;
  return Markup.inlineKeyboard([
    [
      Markup.button.url(
        "👥 Share with roommates",
        buildShareUrl(username, audience, meterId),
      ),
    ],
  ]);
}

/**
 * Reads a /start payload such as "nus_12345678" or "nus_12345678_share".
 * @returns {{ meterId: string, shared: boolean } | null}
 */
function parseMeterStartPayload(
  payload,
  prefix,
  { prefixOptional = false } = {},
) {
  const pattern = new RegExp(
    `^${prefixOptional ? `(?:${prefix}_)?` : `${prefix}_`}(\\d{8})(_${SHARE_SUFFIX})?$`,
  );
  const match = String(payload || "").match(pattern);
  return match ? { meterId: match[1], shared: Boolean(match[2]) } : null;
}

module.exports = {
  buildShareUrl,
  getBotUsername,
  parseMeterStartPayload,
  roommateShareKeyboard,
  shareStartPayload,
};
