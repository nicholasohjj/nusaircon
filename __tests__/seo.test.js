import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildRobotsTxt, buildSitemapXml } = require("../services/seo");

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
});
