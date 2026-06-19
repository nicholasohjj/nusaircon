import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("robots.txt", () => {
  test("allows public pages and blocks transactional paths", () => {
    const robots = fs.readFileSync(
      path.join(process.cwd(), "public/robots.txt"),
      "utf8",
    );

    expect(robots).toContain("Allow: /app/");
    expect(robots).toContain("Allow: /app/terms");
    expect(robots).toContain("Disallow: /webapp");
    expect(robots).toContain("Disallow: /cp2nus/webapp");
    expect(robots).toContain("Disallow: /app/pay");
    expect(robots.split("\n")).not.toContain("Disallow: /");
  });
});
