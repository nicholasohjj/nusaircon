const { Markup } = require("telegraf");

// Added to deep links so /start can tell where a link carrying a meter ID came
// from: a roommate share, a room group chat, an inline balance card, or a QR
// sticker on the meter.
const SHARE_SUFFIX = "share";
const LINK_SOURCES = [SHARE_SUFFIX, "group", "card", "qr"];

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

function meterStartPayload(audience, meterId, source = null) {
  const prefix = audience === "sutd" ? "sutd" : "nus";
  return `${prefix}_${meterId}${source ? `_${source}` : ""}`;
}

function shareStartPayload(audience, meterId) {
  return meterStartPayload(audience, meterId, SHARE_SUFFIX);
}

/** Link that opens the bot in a private chat, ready to top up this meter. */
function topupStartUrl(username, audience, meterId, source = null) {
  return `https://t.me/${username}?start=${meterStartPayload(audience, meterId, source)}`;
}

function buildShareUrl(username, audience, meterId) {
  const deepLink = topupStartUrl(username, audience, meterId, SHARE_SUFFIX);
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
 * @returns {{ meterId: string, shared: boolean, source: string | null } | null}
 */
function parseMeterStartPayload(
  payload,
  prefix,
  { prefixOptional = false } = {},
) {
  const pattern = new RegExp(
    `^${prefixOptional ? `(?:${prefix}_)?` : `${prefix}_`}(\\d{8})(?:_(${LINK_SOURCES.join("|")}))?$`,
  );
  const match = String(payload || "").match(pattern);
  if (!match) return null;
  const source = match[2] || null;
  return { meterId: match[1], shared: source === SHARE_SUFFIX, source };
}

/**
 * Reads a campaign link such as "src_qr_rvrc", used on posters and posts to
 * see which ones bring people in. Telegram allows A-Z, a-z, 0-9, _ and - in
 * a start payload, up to 64 characters.
 * @returns {string|null} the tag after "src_", lowercased
 */
function parseCampaignPayload(payload) {
  const match = String(payload || "").match(/^src_([A-Za-z0-9_-]{1,60})$/);
  return match ? match[1].toLowerCase() : null;
}

module.exports = {
  buildShareUrl,
  parseCampaignPayload,
  getBotUsername,
  parseMeterStartPayload,
  roommateShareKeyboard,
  shareStartPayload,
  topupStartUrl,
};
