const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { resolveDbDir } = require("./dbDir");

// Railway Volume should be mounted at /data. Fall back to local for dev.
const DB_DIR = resolveDbDir();
const DB_PATH = path.join(DB_DIR, "evs_users.db");

if (process.env.DB_DIR?.trim() === "/data" && DB_DIR === ".") {
  console.warn(
    "DB_DIR=/data but /data is not available locally; using ./evs_users.db. Use DB_DIR=/data on Railway with a mounted volume.",
  );
}

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance, safer on crashes
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id   TEXT PRIMARY KEY,
    meter_id  TEXT NOT NULL,
    hostel    TEXT NOT NULL,
    saved_at  INTEGER NOT NULL,
    last_seen INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_meters (
    chat_id   TEXT NOT NULL,
    meter_id  TEXT NOT NULL,
    hostel    TEXT NOT NULL,
    label     TEXT NOT NULL,
    saved_at  INTEGER NOT NULL,
    last_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, meter_id, hostel)
  )
`);

db.exec(`
  INSERT OR IGNORE INTO user_meters (
    chat_id,
    meter_id,
    hostel,
    label,
    saved_at,
    last_used
  )
  SELECT
    chat_id,
    meter_id,
    hostel,
    'Meter ' || substr(meter_id, -4),
    saved_at,
    COALESCE(NULLIF(last_seen, 0), saved_at)
  FROM users
`);

function defaultLabel(meterId) {
  return `Meter ${String(meterId).slice(-4)}`;
}

function normalizeLabel(label, meterId) {
  const clean = String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return clean || defaultLabel(meterId);
}

function syncPrimaryUserRow(chatId) {
  const row = db
    .prepare(
      `
      SELECT meter_id, hostel, saved_at, last_used
      FROM user_meters
      WHERE chat_id = ?
      ORDER BY last_used DESC, saved_at DESC, rowid DESC
      LIMIT 1
    `,
    )
    .get(String(chatId));

  if (!row) {
    db.prepare("DELETE FROM users WHERE chat_id = ?").run(String(chatId));
    return null;
  }

  db.prepare(
    `
    INSERT INTO users (chat_id, meter_id, hostel, saved_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      meter_id = excluded.meter_id,
      hostel = excluded.hostel,
      saved_at = excluded.saved_at
  `,
  ).run(
    String(chatId),
    row.meter_id,
    row.hostel,
    row.saved_at,
    row.last_used || 0,
  );

  return row;
}

/**
 * Save or overwrite a user's meter ID and hostel.
 * @param {string|number} chatId
 * @param {string} meterId   — 8-digit string
 * @param {string} hostel    — "cp2" | "cp2nus"
 * @param {string} label
 */
function saveUser(chatId, meterId, hostel, label = "") {
  const now = Date.now();
  const chatIdText = String(chatId);
  const cleanLabel = normalizeLabel(label, meterId);

  db.prepare(
    `
    INSERT INTO user_meters (chat_id, meter_id, hostel, label, saved_at, last_used)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, meter_id, hostel) DO UPDATE SET
      label = CASE
        WHEN excluded.label = ? THEN user_meters.label
        ELSE excluded.label
      END,
      saved_at = excluded.saved_at,
      last_used = excluded.last_used
  `,
  ).run(chatIdText, meterId, hostel, cleanLabel, now, now, defaultLabel(meterId));

  db.prepare(
    `
    INSERT INTO users (chat_id, meter_id, hostel, saved_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      meter_id = excluded.meter_id,
      hostel   = excluded.hostel,
      saved_at = excluded.saved_at
  `,
  ).run(chatIdText, meterId, hostel, now);
}

function touchUser(chatId) {
  db.prepare(
    `
    UPDATE users SET last_seen = ? WHERE chat_id = ?
  `,
  ).run(Date.now(), String(chatId));
}

function getAllChatIds() {
  return db
    .prepare("SELECT chat_id FROM users")
    .all()
    .map((r) => r.chat_id);
}

function getActiveChatIds(windowMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  return db
    .prepare("SELECT chat_id FROM users WHERE last_seen >= ?")
    .all(cutoff)
    .map((r) => r.chat_id);
}

function getUserStats(windowMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  const total = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const active = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE last_seen >= ?")
    .get(cutoff).count;

  return { total, active };
}

/**
 * Retrieve saved meter ID and hostel for a user.
 * @param {string|number} chatId
 * @returns {{ meterId: string, hostel: string } | null}
 */
function getUser(chatId) {
  const row = db
    .prepare(
      `
      SELECT meter_id, hostel, label
      FROM user_meters
      WHERE chat_id = ?
      ORDER BY last_used DESC, saved_at DESC, rowid DESC
      LIMIT 1
    `,
    )
    .get(String(chatId));

  if (row) {
    return {
      meterId: row.meter_id,
      hostel: row.hostel,
      label: row.label,
    };
  }

  const legacy = db
    .prepare("SELECT meter_id, hostel FROM users WHERE chat_id = ?")
    .get(String(chatId));

  return legacy
    ? {
        meterId: legacy.meter_id,
        hostel: legacy.hostel,
        label: defaultLabel(legacy.meter_id),
      }
    : null;
}

function getSavedMeters(chatId) {
  return db
    .prepare(
      `
      SELECT meter_id, hostel, label, saved_at, last_used
      FROM user_meters
      WHERE chat_id = ?
      ORDER BY last_used DESC, saved_at DESC, rowid DESC
    `,
    )
    .all(String(chatId))
    .map((row) => ({
      meterId: row.meter_id,
      hostel: row.hostel,
      label: row.label,
      savedAt: row.saved_at,
      lastUsed: row.last_used,
    }));
}

function setActiveSavedMeter(chatId, meterId, hostel) {
  const result = db
    .prepare(
      `
      UPDATE user_meters
      SET last_used = ?
      WHERE chat_id = ? AND meter_id = ? AND hostel = ?
    `,
    )
    .run(Date.now(), String(chatId), meterId, hostel);

  if (result.changes > 0) syncPrimaryUserRow(chatId);
  return result.changes > 0;
}

function forgetSavedMeter(chatId, meterId, hostel) {
  const result = db
    .prepare(
      `
      DELETE FROM user_meters
      WHERE chat_id = ? AND meter_id = ? AND hostel = ?
    `,
    )
    .run(String(chatId), meterId, hostel);

  if (result.changes > 0) syncPrimaryUserRow(chatId);
  return result.changes > 0;
}

/**
 * Delete saved meter ID and hostel for a user.
 * @param {string|number} chatId
 * @returns {boolean} true if a row was deleted
 */
function forgetUser(chatId) {
  db.prepare("DELETE FROM user_meters WHERE chat_id = ?").run(String(chatId));
  const result = db
    .prepare("DELETE FROM users WHERE chat_id = ?")
    .run(String(chatId));
  return result.changes > 0;
}

module.exports = {
  saveUser,
  getUser,
  getSavedMeters,
  setActiveSavedMeter,
  forgetSavedMeter,
  forgetUser,
  getAllChatIds,
  getActiveChatIds,
  getUserStats,
  touchUser,
};
