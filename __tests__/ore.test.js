import { describe, expect, test } from "vitest";

const {
  analyzeUsage,
  extractTopupHistory,
  formatTopupHistory,
} = require("../services/ore");

describe("extractTopupHistory", () => {
  test("reads topup_history_3months.history", () => {
    const history = [{ amount: 10 }];

    expect(
      extractTopupHistory({
        topup_history_3months: { history },
      }),
    ).toBe(history);
  });

  test("reads common fallback array shapes", () => {
    const records = [{ amount: 20 }];

    expect(extractTopupHistory({ data: { records } })).toBe(records);
    expect(extractTopupHistory({ topups: records })).toBe(records);
  });

  test("returns an empty array for unknown responses", () => {
    expect(extractTopupHistory({ ok: true })).toEqual([]);
    expect(extractTopupHistory(null)).toEqual([]);
  });
});

describe("formatTopupHistory", () => {
  test("formats recent top-up rows", () => {
    const text = formatTopupHistory([
      {
        transaction_log_timestamp: "2026-05-16 17:49:19",
        topup_amt: "15.00",
        transaction_code: "LVyphbu2",
      },
    ]);

    expect(text).toContain("1. <b>SGD 15.00</b>");
    expect(text).toContain("16 May 2026");
    expect(text).toContain("<code>LVyphbu2</code>");
  });

  test("escapes untrusted response fields", () => {
    const text = formatTopupHistory([
      {
        amount: "<script>",
        date: "not-a-date",
        ref: "A&B",
        status: "<ok>",
      },
    ]);

    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("not-a-date");
    expect(text).toContain("<code>A&amp;B</code>");
    expect(text).toContain("&lt;ok&gt;");
  });

  test("shows an empty state", () => {
    expect(formatTopupHistory([])).toBe("No top-ups found in the last 90 days.");
  });
});

describe("analyzeUsage", () => {
  test("reports below-zero balances without negative days-left text", () => {
    const result = analyzeUsage(
      [{ reading_diff: 2 }, { reading_diff: 2 }],
      "-3.50",
    );
    const warnings = result.warnings.join(" ");

    expect(warnings).toContain("below zero");
    expect(warnings).not.toContain("-1.8 day");
  });
});
