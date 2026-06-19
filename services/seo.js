function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "").replace(/\/+$/, "");
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
  buildRobotsTxt,
  buildSitemapXml,
  normalizeBaseUrl,
};
