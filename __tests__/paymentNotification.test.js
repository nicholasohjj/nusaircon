import { describe, expect, test } from "vitest";

const { buildPaymentNotificationLines } = require("../services/paymentNotification");

describe("buildPaymentNotificationLines", () => {
  test("labels stored balance as pre-top-up balance", () => {
    const lines = buildPaymentNotificationLines({
      status: "success",
      txtMtrId: "10100407",
      txtAmount: "6",
      address: "Block 22",
      balance: "22.78",
      merchantTxnRef: "RN26061700000009",
    });

    const text = lines.join("\n");

    expect(text).toContain("Balance before top-up: SGD 22.78");
    expect(text).not.toContain("New Balance");
  });
});
