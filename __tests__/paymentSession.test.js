import { beforeEach, describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modulePath = "../services/paymentSession";

function loadFreshPaymentSession() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

describe("paymentSession sealed tokens", () => {
  beforeEach(() => {
    process.env.PAYMENT_SESSION_SECRET = "test-payment-session-secret";
  });

  test("round-trips a pending payment session without in-memory state", () => {
    const { createPaymentSession, getPaymentSession } =
      loadFreshPaymentSession();

    const token = createPaymentSession({
      txtMtrId: "12345678",
      txtAmount: "20",
      chatId: "999",
      status: "pending",
      nets: {
        netsMid: "807574000",
        merchantTxnRef: "MTR-001",
      },
    });

    const session = getPaymentSession(token);

    expect(session.txtMtrId).toBe("12345678");
    expect(session.txtAmount).toBe("20");
    expect(session.status).toBe("pending");
    expect(session.nets.netsMid).toBe("807574000");
  });

  test("can read a token after a module reload with the same secret", () => {
    const firstModule = loadFreshPaymentSession();
    const token = firstModule.createPaymentSession({
      txtMtrId: "12345678",
      txtAmount: "20",
      status: "pending",
    });

    const secondModule = loadFreshPaymentSession();
    const session = secondModule.getPaymentSession(token);

    expect(session.txtMtrId).toBe("12345678");
    expect(session.status).toBe("pending");
  });

  test("rejects tampered tokens", () => {
    const { createPaymentSession, getPaymentSession } =
      loadFreshPaymentSession();
    const token = createPaymentSession({
      txtMtrId: "12345678",
      txtAmount: "20",
    });

    const parts = token.split(".");
    parts[2] = parts[2].replace(/^./, (first) =>
      first === "a" ? "b" : "a",
    );
    const tampered = parts.join(".");

    expect(getPaymentSession(tampered)).toBeNull();
  });

  test("creates result tokens without carrying payment gateway fields", () => {
    const { createPaymentResultSession, getPaymentSession } =
      loadFreshPaymentSession();

    const token = createPaymentResultSession({
      txtMtrId: "12345678",
      txtAmount: "20",
      address: "Blk 12",
      balance: "18.50",
      nets: { rsaModulus: "secret-gateway-field" },
      status: "success",
      merchantTxnRef: "MTR-001",
      notifiedAt: 123,
    });

    const session = getPaymentSession(token);

    expect(session.status).toBe("success");
    expect(session.merchantTxnRef).toBe("MTR-001");
    expect(session.nets).toBeUndefined();
    expect(session.notifiedAt).toBe(123);
  });

  test("serves cached receipt PDFs through a result token", () => {
    const {
      createPaymentResultSession,
      getReceiptPdf,
      storeReceiptPdf,
    } = loadFreshPaymentSession();

    const receiptId = storeReceiptPdf(Buffer.from("%PDF test"));
    const token = createPaymentResultSession(
      {
        txtMtrId: "12345678",
        txtAmount: "20",
        status: "success",
      },
      { receiptId },
    );

    expect(getReceiptPdf(token).toString()).toBe("%PDF test");
  });
});
