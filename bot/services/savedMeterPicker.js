const { Markup } = require("telegraf");
const { HOSTELS } = require("../constants");

const CALLBACK_PREFIX = "saved_meter";

const MODE_LABELS = {
  topup: "top-up",
  balance: "balance",
  usage: "usage",
  topups: "top-up history",
};

function shortHostelLabel(hostel) {
  return hostel === HOSTELS.CP2NUS ? "UTown/RVRC" : "PGPR/PGP/RC/NUSC";
}

function savedMeterButtonText(meter) {
  return `${meter.label || `Meter ${meter.meterId.slice(-4)}`} · ${meter.meterId} · ${shortHostelLabel(meter.hostel)}`;
}

function savedMeterCallbackData(mode, meter) {
  return `${CALLBACK_PREFIX}:${mode}:${meter.hostel}:${meter.meterId}`;
}

function newMeterCallbackData(mode) {
  return `${CALLBACK_PREFIX}:${mode}:new`;
}

function savedMeterPickerKeyboard(mode, meters) {
  return Markup.inlineKeyboard([
    ...meters.map((meter) => [
      Markup.button.callback(
        savedMeterButtonText(meter),
        savedMeterCallbackData(mode, meter),
      ),
    ]),
    [Markup.button.callback("➕ Use another meter", newMeterCallbackData(mode))],
  ]);
}

function savedMeterPickerText(mode) {
  return `Choose a saved meter for ${MODE_LABELS[mode] || "this action"}:`;
}

function parseSavedMeterCallback(data) {
  const parts = String(data || "").split(":");
  if (parts[0] !== CALLBACK_PREFIX) return null;

  const mode = parts[1];
  if (!MODE_LABELS[mode]) return null;

  if (parts[2] === "new") {
    return { mode, useNew: true };
  }

  const hostel = parts[2];
  const meterId = parts[3];
  if (![HOSTELS.CP2, HOSTELS.CP2NUS].includes(hostel)) return null;
  if (!/^\d{8}$/.test(meterId)) return null;

  return { mode, hostel, meterId };
}

module.exports = {
  MODE_LABELS,
  savedMeterPickerKeyboard,
  savedMeterPickerText,
  parseSavedMeterCallback,
};
