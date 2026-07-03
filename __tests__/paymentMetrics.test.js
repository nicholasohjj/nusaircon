import { afterEach, describe, expect, test } from "vitest";

const {
  clearPaymentMetrics,
  getRecentPaymentFailureStats,
  recordPaymentFailure,
} = require("../services/paymentMetrics");

afterEach(() => {
  clearPaymentMetrics();
});

describe("payment metrics", () => {
  test("counts recent payment failures within the requested window", () => {
    recordPaymentFailure({ route: "cp2" }, 1_000);
    recordPaymentFailure({ route: "cp2nus" }, 2_000);
    recordPaymentFailure({ route: "sutd" }, 10 * 60 * 1000);

    expect(
      getRecentPaymentFailureStats({
        windowMs: 60 * 1000,
        now: 10 * 60 * 1000,
      }),
    ).toEqual({
      count: 1,
      windowMs: 60 * 1000,
    });
  });
});
