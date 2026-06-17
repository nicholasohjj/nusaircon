import { beforeEach, describe, expect, test } from "vitest";

const {
  acquirePaymentSubmitLock,
  clearPaymentSubmitLocks,
  getPaymentSubmitLockKey,
} = require("../services/paymentSubmitLock");

describe("paymentSubmitLock", () => {
  beforeEach(() => {
    clearPaymentSubmitLocks();
  });

  test("blocks a duplicate submit while the lock is held", () => {
    const key = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });

    const release = acquirePaymentSubmitLock(key);

    expect(typeof release).toBe("function");
    expect(acquirePaymentSubmitLock(key)).toBeNull();
  });

  test("allows a submit after the lock is released", () => {
    const key = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });

    const release = acquirePaymentSubmitLock(key);
    release();

    expect(typeof acquirePaymentSubmitLock(key)).toBe("function");
  });

  test("uses merchant transaction ref before token for keying", () => {
    const first = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });
    const second = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-b",
    });

    expect(first).toBe(second);
  });

  test("separates CP2 and CP2NUS keys", () => {
    const first = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });
    const second = getPaymentSubmitLockKey({
      route: "cp2nus",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });

    expect(first).not.toBe(second);
  });

  test("allows reacquire after lock ttl expires", () => {
    const key = getPaymentSubmitLockKey({
      route: "cp2",
      merchantTxnRef: "RN26061700000009",
      token: "token-a",
    });

    acquirePaymentSubmitLock(key, -1);

    expect(typeof acquirePaymentSubmitLock(key)).toBe("function");
  });
});
