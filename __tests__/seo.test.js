import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildGoogleVerificationFileContent,
  buildRobotsTxt,
  buildSitemapXml,
  normalizeGoogleVerificationFileName,
} = require("../services/seo");

describe("SEO metadata", () => {
  test("robots allows public app pages and blocks payment routes", () => {
    const robots = buildRobotsTxt("https://example.com/");

    expect(robots).toContain("Allow: /app/");
    expect(robots).toContain("Allow: /app/terms");
    expect(robots).toContain("Disallow: /webapp");
    expect(robots).toContain("Disallow: /cp2nus/webapp");
    expect(robots).toContain("Disallow: /app/result");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  test("sitemap lists only public pages", () => {
    const sitemap = buildSitemapXml("https://example.com/");

    expect(sitemap).toContain("<loc>https://example.com/app/</loc>");
    expect(sitemap).toContain("<loc>https://example.com/app/terms</loc>");
    expect(sitemap).not.toContain("webapp");
    expect(sitemap).not.toContain("pay");
    expect(sitemap).not.toContain("result");
  });

  test("normalizes Google verification file names", () => {
    expect(normalizeGoogleVerificationFileName(" googleabc123.html ")).toBe(
      "googleabc123.html",
    );
    expect(normalizeGoogleVerificationFileName("../googleabc123.html")).toBe(
      "",
    );
    expect(normalizeGoogleVerificationFileName("not-google.html")).toBe("");
  });

  test("builds Google verification file content", () => {
    expect(buildGoogleVerificationFileContent("googleabc123.html")).toBe(
      "google-site-verification: googleabc123.html\n",
    );
    expect(
      buildGoogleVerificationFileContent(
        "googleabc123.html",
        "custom-verification-body",
      ),
    ).toBe("custom-verification-body\n");
    expect(buildGoogleVerificationFileContent("../googleabc123.html")).toBe("");
  });
});
