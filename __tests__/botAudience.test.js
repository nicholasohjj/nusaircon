import { afterEach, describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const constantsPath = require.resolve("../bot/constants.js");
const uiPath = require.resolve("../bot/services/ui.js");

function loadUiForAudience(audience) {
  delete require.cache[uiPath];
  delete require.cache[constantsPath];

  if (audience) {
    process.env.TELEGRAM_BOT_AUDIENCE = audience;
  } else {
    delete process.env.TELEGRAM_BOT_AUDIENCE;
  }

  return require("../bot/services/ui.js");
}

describe("bot audience", () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_AUDIENCE;
    delete require.cache[uiPath];
    delete require.cache[constantsPath];
  });

  test("defaults to the NUS Aircon Bot command surface", () => {
    const { helpText } = loadUiForAudience(null);
    const text = helpText();

    expect(text).toContain("NUS Aircon Bot Help");
    expect(text).toContain("/topup");
    expect(text).toContain("/usage");
    expect(text).not.toContain("/sutdbalance");
  });

  test("uses a SUTD-only command surface when configured", () => {
    const { helpText } = loadUiForAudience("sutd");
    const text = helpText();

    expect(text).toContain("SUTD Aircon Bot Help");
    expect(text).toContain("/topup");
    expect(text).toContain("/balance");
    expect(text).toContain("/topups");
    expect(text).not.toContain("/usage");
    expect(text).toContain("Minimum: $10.00 SGD");
  });
});
