const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const { CP2_WEBPOS_BASE, DEFAULT_HEADERS } = require("./config");
const {
  extractHiddenField,
  extractMerchantTxnRef,
  htmlDecode,
} = require("./utils");
const { isValidMeterId } = require("./validators");

const SUTD_MAIN_PATH = "/SUTDMain";
const SUTD_BASE_URL = `${CP2_WEBPOS_BASE}${SUTD_MAIN_PATH}`;
const SUTD_WEBPOS_PATH = "/EVSSUTDWebPOS";
const SUTD_WEBPOS_BASE_URL = `${CP2_WEBPOS_BASE}${SUTD_WEBPOS_PATH}`;
const SUTD_CREDITPAYMENT_URL =
  "http://120.50.44.233/payment_sutd_credit/creditpayment.jsp";
const AXIOS_TIMEOUT_MS = 15_000;

function buildSutdPassword(meterId) {
  const clean = String(meterId || "").trim();
  if (!isValidMeterId(clean)) return "";
  return `SU${clean.slice(-4)}td`;
}

function isValidSutdAmount(txtAmount) {
  const amount = Number(String(txtAmount || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount >= 10 && amount <= 50;
}

function stripHtml(value) {
  return htmlDecode(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\u00a0/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function classifySutdLoginResponse(html) {
  const body = String(html || "");
  const valid =
    /<title>\s*EVS-SUTD\s*<\/title>/i.test(body) &&
    body.includes(`${SUTD_MAIN_PATH}/common/common_leftMenu.jsp`);
  const invalid =
    /Invalid\s+Login\s+ID\s+or\s+Password/i.test(body) ||
    /loginServlet/i.test(body);

  if (valid) return "valid";
  if (invalid) return "invalid";
  return "unknown";
}

function parseSutdTransactionRows(html) {
  const body = String(html || "");
  const rows = [];
  const rowMatches = body.matchAll(
    /<tr\b[^>]*class=["'][^"']*\btblRow\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi,
  );

  for (const match of rowMatches) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => stripHtml(cell[1]),
    );

    if (cells.length < 7 || !cells[0]) continue;

    rows.push({
      transaction_id: cells[0],
      date: cells[1],
      amount: cells[2],
      offer_id: cells[3],
      payment_mode: cells[4],
      channel: cells[5],
      status: cells[6],
      source: "sutd",
    });
  }

  return rows;
}

function parseSutdMeterCredit(html) {
  const text = stripHtml(html);
  const meterId = text.match(/\bMeter ID:\s*(\d{8})\b/i)?.[1] || null;
  const creditBal =
    text.match(/\bTotal Balance:\s*S\$\s*([+-]?\d+(?:\.\d+)?)\b/i)?.[1] ||
    null;
  const packageId = text.match(/\bPackage ID:\s*([A-Z0-9-]+)/i)?.[1] || null;
  const lastRecordedCredit =
    text.match(/\bLast Recorded Credit:\s*S\$\s*([+-]?\d+(?:\.\d+)?)\b/i)?.[1] ||
    null;
  const lastRecordedTimestamp =
    text.match(
      /\bLast Recorded Timestamp:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i,
    )?.[1] || null;

  return {
    meter_info: {
      meter_displayname: meterId,
      package_id: packageId,
      last_recorded_credit: lastRecordedCredit,
      last_recorded_timestamp: lastRecordedTimestamp,
      source: "sutd",
    },
    address: null,
    credit_bal: creditBal,
  };
}

function normalizeSutdAddress(value) {
  const clean = stripHtml(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
}

function parseSutdWebposMeterDetails(html) {
  const body = String(html || "");
  const details = {
    meter_displayname: null,
    address: null,
    source: "sutd",
  };

  const rowMatches = body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => stripHtml(cell[1]))
      .filter(Boolean);

    if (cells.length < 2) continue;

    const label = cells[0].replace(/:$/, "").trim().toLowerCase();
    const value =
      cells
        .slice(1)
        .reverse()
        .find((cell) => cell && cell !== ":") || "";

    if (label === "meter id") {
      details.meter_displayname = value.match(/\b(\d{8})\b/)?.[1] || null;
    }

    if (label === "address") {
      details.address = normalizeSutdAddress(value);
    }
  }

  return details;
}

function hasNextTransactionPage(html) {
  return /class=["']pagingLink["'][^>]*href=["'][^"']*listTransactionServlet[^"']*page=\d+[^"']*["'][^>]*>\s*next\s*<\/a>/i.test(
    String(html || ""),
  );
}

function createSutdClient() {
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      validateStatus: () => true,
      maxRedirects: 0,
      timeout: AXIOS_TIMEOUT_MS,
      headers: {
        ...DEFAULT_HEADERS,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      },
    }),
  );
  return { client, jar };
}

async function getFollowRedirects(
  client,
  url,
  { params, headers, maxHops = 4 } = {},
) {
  let currentUrl = String(url);
  let resp = null;
  let hops = 0;

  while (hops <= maxHops) {
    resp = await client.get(currentUrl, { params, headers });
    const status = resp?.status;
    const loc = resp?.headers?.location;

    if (![301, 302, 303, 307, 308].includes(status) || !loc) return resp;

    currentUrl = new URL(loc, currentUrl).toString();
    params = undefined;
    hops += 1;
  }

  return resp;
}

async function loginSutd(client, meterId) {
  const cleanMeterId = String(meterId || "").trim();
  const password = buildSutdPassword(cleanMeterId);
  if (!password) throw new Error("Meter ID must be exactly 8 digits.");

  await client.get(`${SUTD_BASE_URL}/`).catch(() => null);

  const body = new URLSearchParams({
    txtLoginId: cleanMeterId,
    txtPassword: password,
    btnLogin: "Login",
  }).toString();

  const resp = await client.post(`${SUTD_BASE_URL}/loginServlet`, body, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: CP2_WEBPOS_BASE,
      Referer: `${SUTD_BASE_URL}/common/common_leftMenu.jsp`,
    },
  });

  if (resp.status !== 200) {
    throw new Error(`SUTD login returned HTTP ${resp.status}`);
  }

  const loginResult = classifySutdLoginResponse(resp.data);
  if (loginResult !== "valid") {
    throw new Error(`SUTD login ${loginResult}`);
  }

  return resp;
}

async function runSutdPurchaseFlow({ txtMtrId, txtAmount }) {
  const result = { ok: false, stage: "init" };

  if (!txtMtrId) return { ...result, error: "Missing txtMtrId" };
  if (txtAmount === undefined || txtAmount === null || txtAmount === "") {
    return { ...result, error: "Missing txtAmount" };
  }

  if (!isValidMeterId(txtMtrId)) {
    return { ...result, error: "Meter ID must be exactly 8 digits." };
  }

  if (!isValidSutdAmount(txtAmount)) {
    return { ...result, error: "Amount must be between $10.00 and $50.00." };
  }

  const amountDollars = Number(String(txtAmount).replace(/[^0-9.]/g, ""));
  const amountCents = Math.round(amountDollars * 100);
  const { client, jar } = createSutdClient();

  result.stage = "evs_home";
  const step1 = await client.get(`${SUTD_WEBPOS_BASE_URL}/`);

  result.stage = "login";
  const loginForm = new URLSearchParams({
    txtMtrId: String(txtMtrId),
    btnLogin: "Submit",
    radRetail: "1",
  }).toString();

  const step2 = await client.post(
    `${SUTD_WEBPOS_BASE_URL}/loginServlet`,
    loginForm,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CP2_WEBPOS_BASE,
        Referer: `${SUTD_WEBPOS_BASE_URL}/`,
      },
    },
  );

  const loginResult = classifySutdWebposLoginResponse(step2.data);
  if (loginResult !== "valid") {
    const cookies = await jar.getCookies(`${SUTD_WEBPOS_BASE_URL}/`);
    return {
      ok: false,
      stage: "login",
      step1Status: step1.status,
      step2Status: step2.status,
      loginResult,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
    };
  }

  const webposMeterDetails = parseSutdWebposMeterDetails(step2.data);

  result.stage = "select_offer";
  const selectForm = new URLSearchParams({
    isDedicated: "0",
    hidMinPur: "1",
    hidMaxPur: "500",
    hidSelected: "",
    txtAmount: String(amountDollars),
    btnProceed: "Proceed",
    btnCancel: "Cancel",
  }).toString();

  const step3 = await client.post(
    `${SUTD_WEBPOS_BASE_URL}/selectOfferServlet`,
    selectForm,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CP2_WEBPOS_BASE,
        Referer: `${SUTD_WEBPOS_BASE_URL}/loginServlet`,
      },
    },
  );

  const selectResult = classifySutdWebposSelectOfferResponse(step3.data);
  const cookies = await jar.getCookies(`${SUTD_WEBPOS_BASE_URL}/`);

  if (selectResult !== "success") {
    return {
      ok: false,
      stage: "select_offer",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      loginResult,
      selectResult,
      address: webposMeterDetails.address,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      preview: {
        loginTitle:
          String(step2.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        selectTitle:
          String(step3.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
      },
    };
  }

  result.stage = "payment_servlet";
  const step4 = await getFollowRedirects(
    client,
    `${SUTD_WEBPOS_BASE_URL}/paymentServlet`,
    {
      params: { mode: "0", isDedicated: "1" },
      headers: {
        ...DEFAULT_HEADERS,
        Referer: `${SUTD_WEBPOS_BASE_URL}/selectOfferServlet`,
      },
    },
  );

  const merchant_txn_ref = extractMerchantTxnRef(step4.data);
  if (!merchant_txn_ref) {
    return {
      ok: false,
      stage: "payment_servlet",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      step4Status: step4.status,
      loginResult,
      selectResult,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      error: "merchant_txn_ref not found in SUTD paymentServlet HTML",
      upstream: {
        paymentTitle:
          String(step4.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        paymentContentType: step4.headers?.["content-type"] || null,
        paymentLocation: step4.headers?.location || null,
        paymentPreview: String(step4.data || "").slice(0, 800),
      },
    };
  }

  result.stage = "creditpayment";
  const formBody = new URLSearchParams({
    amt: amountDollars.toFixed(2),
    payment_mode: "CC",
    txn_amount: String(amountCents),
    currency_code: "SGD",
    merchant_txn_ref: String(merchant_txn_ref),
    submission_mode: "B",
    payment_type: "SALE",
  }).toString();

  const step5 = await axios.post(SUTD_CREDITPAYMENT_URL, formBody, {
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    validateStatus: () => true,
  });

  const enetsMessage = extractHiddenField(step5.data, "message");
  if (!enetsMessage) {
    return {
      ok: false,
      stage: "enets_paymentlistener",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      step4Status: step4.status,
      step5Status: step5.status,
      loginResult,
      selectResult,
      merchant_txn_ref,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      error: "message not found in SUTD creditpayment.jsp HTML",
    };
  }

  result.stage = "enets_paymentlistener";
  const step6 = await axios.post(
    "https://www.enets.sg/enets2/PaymentListener.do",
    new URLSearchParams({ message: String(enetsMessage) }).toString(),
    {
      headers: {
        ...DEFAULT_HEADERS,
        Origin: "http://120.50.44.233",
        Referer: "http://120.50.44.233/",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      validateStatus: () => true,
    },
  );

  const enetsHtml = String(step6.data || "");
  return {
    ok: true,
    stage: "enets_paymentlistener",
    step1Status: step1.status,
    step2Status: step2.status,
    step3Status: step3.status,
    step4Status: step4.status,
    step5Status: step5.status,
    step6Status: step6.status,
    merchant_txn_ref,
    address: webposMeterDetails.address,
    meterInfo: webposMeterDetails,
    enetsBody: step6.data,
    enets: {
      netsMid: extractHiddenField(enetsHtml, "netsMid"),
      e: extractHiddenField(enetsHtml, "e"),
      n: extractHiddenField(enetsHtml, "n"),
      netsTxnRef: extractHiddenField(enetsHtml, "netsTxnRef"),
    },
  };
}

function classifySutdWebposLoginResponse(html) {
  const body = String(html || "");
  const valid =
    body.includes("<title>EVS POS Package Selection Page</title>") ||
    body.includes(`${SUTD_WEBPOS_PATH}/selectOfferServlet`) ||
    body.includes("Please confirm you are purchasing for the above premise");
  const invalid =
    body.includes("Meter not found.") ||
    body.includes(`${SUTD_WEBPOS_PATH}/loginServlet`);

  if (valid) return "valid";
  if (invalid) return "invalid";
  return "unknown";
}

function classifySutdWebposSelectOfferResponse(html) {
  const body = String(html || "");
  const success =
    body.includes("<title>EVS POS Payment Selection Page</title>") ||
    body.includes("Please select a payment mode") ||
    body.includes("img_creditcard") ||
    body.includes("hidPurAmt");
  const packagePage =
    body.includes("<title>EVS POS Package Selection Page</title>") ||
    body.includes("Please confirm you are purchasing for the above premise") ||
    body.includes(`${SUTD_WEBPOS_PATH}/selectOfferServlet`);

  if (success) return "success";
  if (packagePage) return "stayed_on_package_page";
  return "unknown";
}

async function postSutdResultToEvs({ status, id, message, jsessionid }) {
  const headers = {
    ...DEFAULT_HEADERS,
    Origin: "https://www.enets.sg",
    Referer: "https://www.enets.sg/",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (jsessionid) headers.Cookie = `JSESSIONID=${String(jsessionid).trim()}`;

  const evsResp = await axios.post(
    `${SUTD_WEBPOS_BASE_URL}/transSumServlet?status=${encodeURIComponent(
      String(status),
    )}&id=${encodeURIComponent(String(id))}`,
    new URLSearchParams({ message: String(message) }).toString(),
    {
      headers,
      validateStatus: () => true,
      maxRedirects: 0,
    },
  );

  return {
    upstreamStatus: evsResp.status,
    html: String(evsResp.data || ""),
    parsed: parseSutdTransactionSummary(evsResp.data),
  };
}

async function fetchSutdTransactionPage(client, meterId, page = 1) {
  const resp = await client.get(`${SUTD_BASE_URL}/listTransactionServlet`, {
    params: {
      selMeters: String(meterId).trim(),
      sta: "3",
      page: String(page),
    },
    headers: {
      ...DEFAULT_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      Referer: `${SUTD_BASE_URL}/listTransactionServlet`,
    },
  });

  if (resp.status !== 200) {
    throw new Error(`SUTD transaction history returned HTTP ${resp.status}`);
  }

  return String(resp.data || "");
}

async function fetchSutdMeterCreditPage(client) {
  const resp = await client.get(`${SUTD_BASE_URL}/viewMeterCreditServlet`, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      Referer: `${SUTD_BASE_URL}/common/common_leftMenu.jsp`,
    },
  });

  if (resp.status !== 200) {
    throw new Error(`SUTD meter credit returned HTTP ${resp.status}`);
  }

  return String(resp.data || "");
}

async function getSutdMeterSummary(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!isValidMeterId(meterId)) {
    return { address: null, credit_bal: null, meter_info: null };
  }

  const { client } = createSutdClient();
  await loginSutd(client, meterId);
  const html = await fetchSutdMeterCreditPage(client);
  return parseSutdMeterCredit(html);
}

async function getSutdRecentTopups(
  meterDisplayName,
  { numberOfTopups = 10, maxPages = 3 } = {},
) {
  const meterId = String(meterDisplayName || "").trim();
  if (!isValidMeterId(meterId)) {
    return {
      numberOfTopups,
      lookbackDays: null,
      history: [],
      meta: { source: "sutd" },
    };
  }

  const { client } = createSutdClient();
  await loginSutd(client, meterId);

  const history = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    const html = await fetchSutdTransactionPage(client, meterId, page);
    const rows = parseSutdTransactionRows(html);
    let newRows = 0;

    for (const row of rows) {
      const key = row.transaction_id || `${row.date}:${row.amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      history.push(row);
      newRows += 1;
      if (history.length >= numberOfTopups) break;
    }

    if (
      history.length >= numberOfTopups ||
      !hasNextTransactionPage(html) ||
      (page > 1 && newRows === 0)
    ) {
      break;
    }
  }

  return {
    numberOfTopups,
    lookbackDays: null,
    history: history.slice(0, numberOfTopups),
    meta: { source: "sutd" },
  };
}

module.exports = {
  buildSutdPassword,
  classifySutdLoginResponse,
  classifySutdWebposLoginResponse,
  classifySutdWebposSelectOfferResponse,
  getSutdMeterSummary,
  getSutdRecentTopups,
  isValidSutdAmount,
  parseSutdMeterCredit,
  parseSutdTransactionRows,
  parseSutdWebposMeterDetails,
  postSutdResultToEvs,
  runSutdPurchaseFlow,
};

function parseSutdTransactionSummary(html) {
  const body = String(html || "");
  const parsed = {
    title: body.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || null,
    merchantTxnRef:
      body.match(/transSumServlet\?status=\d+&amp;id=([^"&]+)/i)?.[1] ||
      body.match(/transSumServlet\?status=\d+&id=([^"&]+)/i)?.[1] ||
      null,
    meterId:
      body.match(/Meter ID[\s\S]*?<b><u>(\d{5,})<\/u><\/b>/i)?.[1] ||
      body.match(/<b><u>(\d{5,})<\/u><\/b>/i)?.[1] ||
      null,
    address:
      body.match(/Address[\s\S]*?<b><u>([^<]+)<\/u><\/b>/i)?.[1]?.trim() ||
      null,
    amount:
      body
        .match(
          /Total Amount \(Inclusive of GST\)[\s\S]*?<b>(S\$ ?[\d.]+)<\/b>/i,
        )?.[1]
        ?.trim() ||
      body.match(/<b>S\$ ?([\d.]+)<\/b>/i)?.[1] ||
      null,
  };

  const alertText =
    body
      .match(/<span[^>]*\bid=["']lblAlert["'][^>]*>\s*([^<]+)\s*<\/span>/i)?.[1]
      ?.trim() || null;
  const isFailure =
    /Failed to purchase/i.test(body) ||
    /Transaction is rejected/i.test(body) ||
    (alertText != null && !/Thank You/i.test(alertText));

  return {
    ...parsed,
    status: isFailure ? "failure" : "success",
    reason: isFailure
      ? alertText || "Transaction rejected."
      : "Payment completed.",
  };
}
