function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "").replace(/\/+$/, "");
}

const SEO_HEAD_START = "<!-- seo:head:start -->";
const SEO_HEAD_END = "<!-- seo:head:end -->";

const SITE_NAME = "EVS Meter Tools";
const HOME_DESCRIPTION =
  "Check supported NUS and SUTD EVS meter balances and top-up history, and top up supported EVS meters online.";
// const CP2_DESCRIPTION =
//   "Legacy CP2 top-up flow for NUS hostel meters that have not migrated to CP2NUS.";
const CP2NUS_DESCRIPTION =
  "Top up and check EVS meter balances for supported NUS hostel meters through the CP2NUS EVS system.";
const BALANCE_DESCRIPTION =
  "Check supported NUS and SUTD EVS meter balances online before topping up.";
const SUTD_DESCRIPTION =
  "Check SUTD EVS meter balances and top-up history, and top up supported SUTD EVS meters online.";
const TERMS_DESCRIPTION =
  "Terms of Use for the unofficial EVS Meter Tools bot and web app for supported EVS electricity meters.";

const PUBLIC_PAGE_SEO = {
  "/app/": {
    title: "NUS and SUTD EVS Top Up | EVS Meter Tools",
    description: HOME_DESCRIPTION,
    canonicalPath: "/app/",
    ogType: "website",
    schemaType: "WebApplication",
    audienceType: "NUS and SUTD EVS meter users",
  },
  // Legacy CP2 fallback — hidden from the UI.
  // "/app/cp2": {
  //   title: "Legacy CP2 EVS Top Up | EVS Meter Tools",
  //   description: CP2_DESCRIPTION,
  //   canonicalPath: "/app/cp2",
  //   ogType: "website",
  //   schemaType: "WebApplication",
  //   audienceType: "Legacy CP2 EVS meter users",
  // },
  "/app/cp2nus": {
    title: "NUS CP2NUS EVS Top Up | EVS Meter Tools",
    description: CP2NUS_DESCRIPTION,
    canonicalPath: "/app/cp2nus",
    ogType: "website",
    schemaType: "WebApplication",
    audienceType: "NUS CP2NUS EVS meter users",
  },
  "/app/balance": {
    title: "EVS Meter Balance Check | EVS Meter Tools",
    description: BALANCE_DESCRIPTION,
    canonicalPath: "/app/balance",
    ogType: "website",
    schemaType: "WebApplication",
    audienceType: "NUS and SUTD EVS meter users checking meter balance",
  },
  "/app/sutd": {
    title: "SUTD EVS Top Up | EVS Meter Tools",
    description: SUTD_DESCRIPTION,
    canonicalPath: "/app/sutd",
    ogType: "website",
    schemaType: "WebApplication",
    audienceType: "SUTD EVS meter users",
  },
  "/app/terms": {
    title: "Terms of Use | EVS Meter Tools",
    description: TERMS_DESCRIPTION,
    canonicalPath: "/app/terms",
    ogType: "article",
    schemaType: "WebPage",
  },
};

function normalizePathname(pathname = "/") {
  let normalized;

  try {
    normalized = new URL(String(pathname || "/"), "http://local").pathname;
  } catch {
    normalized = String(pathname || "/").split(/[?#]/)[0] || "/";
  }

  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized === "/app") return "/app/";
  if (normalized !== "/" && normalized !== "/app/" && normalized.endsWith("/")) {
    return normalized.replace(/\/+$/, "");
  }
  return normalized;
}

function absoluteUrl(baseUrl = "", pathname = "/") {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalizedBaseUrl
    ? `${normalizedBaseUrl}${normalizedPathname}`
    : normalizedPathname;
}

function normalizeGoogleVerificationFileName(fileName = "") {
  const normalized = String(fileName || "").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    return "";
  }

  return /^google[a-zA-Z0-9_-]+\.html$/.test(normalized) ? normalized : "";
}

function buildGoogleVerificationFileContent(fileName, content = "") {
  const normalizedFileName = normalizeGoogleVerificationFileName(fileName);
  if (!normalizedFileName) return "";

  const body =
    content === ""
      ? `google-site-verification: ${normalizedFileName}`
      : String(content);

  return body.endsWith("\n") ? body : `${body}\n`;
}

function buildRobotsTxt(baseUrl = "") {
  const lines = [
    "User-agent: *",
    "Allow: /app/",
    // "Allow: /app/cp2",
    "Allow: /app/cp2nus",
    "Allow: /app/balance",
    "Allow: /app/sutd",
    "Allow: /app/terms",
    "Allow: /assets/",
    "Disallow: /api",
    "Disallow: /debug",
    "Disallow: /health",
    "Disallow: /telegram/",
    "Disallow: /webapp",
    "Disallow: /cp2nus/webapp",
    "Disallow: /sutd/webapp",
    "Disallow: /app/loading",
    "Disallow: /app/pay",
    "Disallow: /app/result",
    "Disallow: /app/cp2nus/loading",
    "Disallow: /app/cp2nus/pay",
    "Disallow: /app/cp2nus/result",
    "Disallow: /app/sutd/loading",
    "Disallow: /app/sutd/pay",
    "Disallow: /app/sutd/result",
  ];

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl) lines.push(`Sitemap: ${normalizedBaseUrl}/sitemap.xml`);

  return `${lines.join("\n")}\n`;
}

function xmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function jsStringEscape(value) {
  return String(value || "").replaceAll("<", "\\u003c");
}

function buildStructuredData(metadata, baseUrl = "") {
  if (!metadata.schemaType || !metadata.canonicalUrl) return null;

  const siteUrl = absoluteUrl(baseUrl, "/app/");
  const baseSchema = {
    "@context": "https://schema.org",
    "@type": metadata.schemaType,
    name: metadata.schemaType === "WebPage" ? metadata.title : SITE_NAME,
    url: metadata.canonicalUrl,
    description: metadata.description,
    inLanguage: "en-SG",
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: siteUrl,
    },
  };

  if (metadata.schemaType === "WebApplication") {
    return {
      ...baseSchema,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      audience: {
        "@type": "Audience",
        audienceType: metadata.audienceType || "Supported EVS meter users",
      },
      termsOfService: absoluteUrl(baseUrl, "/app/terms"),
    };
  }

  return baseSchema;
}

function getSeoMetadata(pathname = "/app/", baseUrl = "") {
  const normalizedPathname = normalizePathname(pathname);
  const page =
    PUBLIC_PAGE_SEO[normalizedPathname] ||
    (normalizedPathname === "/app" ? PUBLIC_PAGE_SEO["/app/"] : null);

  if (!page) {
    return {
      title: SITE_NAME,
      description: HOME_DESCRIPTION,
      robots: "noindex, nofollow",
      canonicalUrl: "",
      ogType: "website",
      schemaType: "",
    };
  }

  const canonicalUrl = absoluteUrl(baseUrl, page.canonicalPath);
  return {
    ...page,
    robots: "index, follow",
    canonicalUrl,
  };
}

function shouldSendNoindexHeader(pathname = "") {
  const normalizedPathname = normalizePathname(pathname);

  return (
    normalizedPathname === "/api" ||
    normalizedPathname.startsWith("/api/") ||
    normalizedPathname === "/debug" ||
    normalizedPathname === "/health" ||
    normalizedPathname === "/webapp" ||
    normalizedPathname.startsWith("/webapp/") ||
    normalizedPathname === "/cp2nus/webapp" ||
    normalizedPathname.startsWith("/cp2nus/webapp/") ||
    normalizedPathname === "/sutd/webapp" ||
    normalizedPathname.startsWith("/sutd/webapp/") ||
    (normalizedPathname.startsWith("/app/") &&
      !normalizedPathname.startsWith("/app/assets/") &&
      !PUBLIC_PAGE_SEO[normalizedPathname])
  );
}

function buildSeoHeadTags(pathname = "/app/", baseUrl = "") {
  const metadata = getSeoMetadata(pathname, baseUrl);
  const structuredData = buildStructuredData(metadata, baseUrl);
  const imageUrl = absoluteUrl(baseUrl, "/app/og-image.png");
  const lines = [
    `<title>${xmlEscape(metadata.title)}</title>`,
    `<meta name="description" content="${xmlEscape(metadata.description)}" />`,
    `<meta name="robots" content="${xmlEscape(metadata.robots)}" />`,
    `<meta property="og:site_name" content="${xmlEscape(SITE_NAME)}" />`,
    `<meta property="og:title" content="${xmlEscape(metadata.title)}" />`,
    `<meta property="og:description" content="${xmlEscape(
      metadata.description,
    )}" />`,
    `<meta property="og:type" content="${xmlEscape(metadata.ogType)}" />`,
    `<meta property="og:image" content="${xmlEscape(imageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${xmlEscape(metadata.title)}" />`,
    `<meta name="twitter:description" content="${xmlEscape(
      metadata.description,
    )}" />`,
    `<meta name="twitter:image" content="${xmlEscape(imageUrl)}" />`,
  ];

  if (metadata.canonicalUrl) {
    lines.splice(
      3,
      0,
      `<link rel="canonical" href="${xmlEscape(metadata.canonicalUrl)}" />`,
    );
    lines.splice(
      8,
      0,
      `<meta property="og:url" content="${xmlEscape(metadata.canonicalUrl)}" />`,
    );
  }

  if (structuredData) {
    lines.push(
      `<script type="application/ld+json">${jsStringEscape(
        JSON.stringify(structuredData),
      )}</script>`,
    );
  }

  return lines.map((line) => `    ${line}`).join("\n");
}

function injectSeoHead(html = "", pathname = "/app/", baseUrl = "") {
  const seoBlock = `${SEO_HEAD_START}\n${buildSeoHeadTags(
    pathname,
    baseUrl,
  )}\n    ${SEO_HEAD_END}`;
  const markerPattern = new RegExp(
    `${SEO_HEAD_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${SEO_HEAD_END.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}`,
  );

  if (markerPattern.test(html)) {
    return html.replace(markerPattern, seoBlock);
  }

  return String(html || "").replace("</head>", `${seoBlock}\n  </head>`);
}

function buildSitemapXml(baseUrl = "") {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const urls = [
    "/app/",
    // "/app/cp2",
    "/app/cp2nus",
    "/app/balance",
    "/app/sutd",
    "/app/terms",
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${xmlEscape(`${normalizedBaseUrl}${url}`)}</loc>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
}

function buildLlmsTxt(baseUrl = "") {
  const base = normalizeBaseUrl(baseUrl);
  const docs = "https://github.com/nicholasohjj/nusaircon/blob/main";
  return `# EVS Meter Tools

> An unofficial tool for checking EVS prepaid electricity meters at NUS and SUTD hostels, and topping them up by card. It is not affiliated with NUS, SUTD, EVS or eNETS.

AI agents should use the MCP server rather than the website. It needs no account or API key.

- MCP endpoint (Streamable HTTP): ${base}/mcp
- Tools: get_meter_balance, get_meter_usage (NUS only), get_recent_topups, get_topup_link

Agents cannot make payments here. get_topup_link returns a link for the user to open and pay by card themselves. Never ask for card details, and never fill in the payment page for the user.

Only look up a meter the user is authorised to access.

## Docs

- [Connect an AI assistant](${docs}/README.md#connect-your-own-claude-mcp): tools, error codes and rate limits
- [Scheduled balance check](${docs}/docs/scheduled-balance-check.md): prompts for a daily check that ends with a payment link
- [Self-hosting](${docs}/docs/self-hosting.md): run your own copy
- [Terms](${base}/app/terms): rules for using the service
`;
}

module.exports = {
  buildSeoHeadTags,
  buildGoogleVerificationFileContent,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  getSeoMetadata,
  injectSeoHead,
  normalizeBaseUrl,
  normalizeGoogleVerificationFileName,
  normalizePathname,
  shouldSendNoindexHeader,
};
