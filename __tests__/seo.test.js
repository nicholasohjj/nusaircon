import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSeoHeadTags,
  buildGoogleVerificationFileContent,
  buildRobotsTxt,
  buildSitemapXml,
  getSeoMetadata,
  injectSeoHead,
  normalizeGoogleVerificationFileName,
  shouldSendNoindexHeader,
} = require("../services/seo");

describe("SEO metadata", () => {
  test("robots allows public app pages and blocks payment routes", () => {
    const robots = buildRobotsTxt("https://example.com/");

    expect(robots).toContain("Allow: /app/");
    expect(robots).toContain("Allow: /app/cp2nus");
    expect(robots).toContain("Allow: /app/sutd");
    expect(robots).toContain("Allow: /app/terms");
    expect(robots).toContain("Disallow: /webapp");
    expect(robots).toContain("Disallow: /cp2nus/webapp");
    expect(robots).toContain("Disallow: /app/result");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  test("sitemap lists only public pages", () => {
    const sitemap = buildSitemapXml("https://example.com/");

    expect(sitemap).toContain("<loc>https://example.com/app/</loc>");
    expect(sitemap).toContain("<loc>https://example.com/app/cp2nus</loc>");
    expect(sitemap).toContain("<loc>https://example.com/app/sutd</loc>");
    expect(sitemap).toContain("<loc>https://example.com/app/terms</loc>");
    expect(sitemap).not.toContain("webapp");
    expect(sitemap).not.toContain("pay");
    expect(sitemap).not.toContain("result");
  });

  test("builds route-specific metadata for public pages", () => {
    const home = getSeoMetadata("/app/", "https://example.com/");
    const cp2nus = getSeoMetadata("/app/cp2nus", "https://example.com/");
    const sutd = getSeoMetadata("/app/sutd", "https://example.com/");
    const terms = getSeoMetadata("/app/terms", "https://example.com/");

    expect(home.title).toBe("NUS and SUTD EVS Top Up | EVS Meter Tools");
    expect(home.description).toContain("NUS and SUTD EVS meter");
    expect(home.canonicalUrl).toBe("https://example.com/app/");
    expect(home.robots).toBe("index, follow");
    expect(cp2nus.title).toBe(
      "UTown, RVRC and Valour House EVS Top Up | EVS Meter Tools",
    );
    expect(cp2nus.description).toContain("Valour House");
    expect(cp2nus.canonicalUrl).toBe("https://example.com/app/cp2nus");
    expect(cp2nus.robots).toBe("index, follow");
    expect(sutd.title).toBe("SUTD EVS Top Up | EVS Meter Tools");
    expect(sutd.description).toContain("SUTD EVS meter balances");
    expect(sutd.canonicalUrl).toBe("https://example.com/app/sutd");
    expect(sutd.robots).toBe("index, follow");
    expect(terms.title).toBe("Terms of Use | EVS Meter Tools");
    expect(terms.canonicalUrl).toBe("https://example.com/app/terms");
  });

  test("builds canonical social tags and structured data", () => {
    const head = buildSeoHeadTags("/app/", "https://example.com/");

    expect(head).toContain(
      '<link rel="canonical" href="https://example.com/app/" />',
    );
    expect(head).toContain(
      '<meta property="og:url" content="https://example.com/app/" />',
    );
    expect(head).toContain('type="application/ld+json"');
    expect(head).toContain('"@type":"WebApplication"');
  });

  test("marks transactional app pages as noindex", () => {
    const head = buildSeoHeadTags("/app/pay", "https://example.com/");

    expect(head).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(head).not.toContain('rel="canonical"');
    expect(shouldSendNoindexHeader("/app/pay")).toBe(true);
    expect(shouldSendNoindexHeader("/webapp/bootstrap")).toBe(true);
    expect(shouldSendNoindexHeader("/app/cp2nus")).toBe(false);
    expect(shouldSendNoindexHeader("/app/sutd")).toBe(false);
    expect(shouldSendNoindexHeader("/app/sutd/pay")).toBe(true);
    expect(shouldSendNoindexHeader("/app/terms")).toBe(false);
  });

  test("injects SEO into the HTML marker block", () => {
    const html = `<!doctype html><html><head>
    <!-- seo:head:start -->
    <title>Old title</title>
    <!-- seo:head:end -->
  </head><body></body></html>`;
    const injected = injectSeoHead(html, "/app/terms", "https://example.com/");

    expect(injected).toContain(
      "<title>Terms of Use | EVS Meter Tools</title>",
    );
    expect(injected).toContain(
      '<link rel="canonical" href="https://example.com/app/terms" />',
    );
    expect(injected).not.toContain("Old title");
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
