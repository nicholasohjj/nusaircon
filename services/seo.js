function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "").replace(/\/+$/, "");
}

const SEO_HEAD_START = "<!-- seo:head:start -->";
const SEO_HEAD_END = "<!-- seo:head:end -->";

const SITE_NAME = "NUS EVS Electricity Top-Up";
const HOME_DESCRIPTION =
  "Top up supported NUS hostel EVS electricity meters online for PGPR, Houses at PGP, Residential Colleges, NUS College, UTown Residence, and RVRC.";
const TERMS_DESCRIPTION =
  "Terms of Use for the unofficial EVS Electricity Top-Up Bot and web app for supported NUS hostel electricity meters.";

const PUBLIC_PAGE_SEO = {
  "/app/": {
    title: "NUS EVS Electricity Top-Up | Hostel Meter Payments",
    description: HOME_DESCRIPTION,
    canonicalPath: "/app/",
    ogType: "website",
    schemaType: "WebApplication",
  },
  "/app/terms": {
    title: "Terms of Use | NUS EVS Electricity Top-Up",
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
    "Allow: /app/terms",
    "Allow: /assets/",
    "Disallow: /api",
    "Disallow: /debug",
    "Disallow: /health",
    "Disallow: /telegram/",
    "Disallow: /webapp",
    "Disallow: /cp2nus/webapp",
    "Disallow: /app/loading",
    "Disallow: /app/pay",
    "Disallow: /app/result",
    "Disallow: /app/cp2nus/loading",
    "Disallow: /app/cp2nus/pay",
    "Disallow: /app/cp2nus/result",
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
        audienceType: "NUS hostel residents",
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
    (normalizedPathname.startsWith("/app/") &&
      !normalizedPathname.startsWith("/app/assets/") &&
      !PUBLIC_PAGE_SEO[normalizedPathname])
  );
}

function buildSeoHeadTags(pathname = "/app/", baseUrl = "") {
  const metadata = getSeoMetadata(pathname, baseUrl);
  const structuredData = buildStructuredData(metadata, baseUrl);
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
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${xmlEscape(metadata.title)}" />`,
    `<meta name="twitter:description" content="${xmlEscape(
      metadata.description,
    )}" />`,
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
  const urls = ["/app/", "/app/terms"];

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

module.exports = {
  buildSeoHeadTags,
  buildGoogleVerificationFileContent,
  buildRobotsTxt,
  buildSitemapXml,
  getSeoMetadata,
  injectSeoHead,
  normalizeBaseUrl,
  normalizeGoogleVerificationFileName,
  normalizePathname,
  shouldSendNoindexHeader,
};
