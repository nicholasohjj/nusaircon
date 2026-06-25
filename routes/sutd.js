require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const router = express.Router();
const { getPaymentBot } = require("../bot/bot");
const { track, captureException } = require("../services/analytics");
const { isValidMeterId } = require("../services/validators");
const {
  extractHiddenField,
  extractMerchantTxnRef,
  normalizeFinalOutcome,
  parseEnetsResult,
} = require("../services/utils");
const {
  getSutdMeterSummary,
  isValidSutdAmount,
  postSutdResultToEvs,
  runSutdPurchaseFlow,
} = require("../services/sutdService");
const { extractEvsCallbackFromHtml } = require("../services/cp2Service");
const {
  createPaymentResultSession,
  createPaymentSession,
  getPaymentSession,
} = require("../services/paymentSession");
const { sendPaymentNotification } = require("../services/paymentNotification");
const {
  acquirePaymentSubmitLock,
  getPaymentSubmitLockKey,
} = require("../services/paymentSubmitLock");
const { DEFAULT_HEADERS } = require("../services/config");
const { errorPage } = require("../views/errorPage");

router.use(express.urlencoded({ extended: false }));
router.use(express.json());

function sutdValidationError({ txtMtrId, txtAmount }) {
  if (!txtMtrId && !txtAmount) {
    return "Please enter your meter ID and top-up amount.";
  }
  if (!txtMtrId) return "Please enter your meter ID.";
  if (!txtAmount) return "Please enter a top-up amount.";
  if (!isValidMeterId(txtMtrId)) {
    return "Invalid meter ID. Meter ID must be exactly 8 digits.";
  }
  if (!isValidSutdAmount(txtAmount)) {
    return "Invalid amount. Please enter an amount between $10.00 and $50.00.";
  }
  return null;
}

async function createNotifiedResultToken(session, updates) {
  const resultSession = { ...session, ...updates };

  try {
    const notifiedAt = await sendPaymentNotification(
      getPaymentBot("sutd"),
      resultSession,
    );
    if (notifiedAt) resultSession.notifiedAt = notifiedAt;
  } catch (err) {
    console.error("notify error", err);
  }

  return createPaymentResultSession(resultSession);
}

function buildRestartUrl(session) {
  const params = new URLSearchParams({
    txtMtrId: session.txtMtrId || "",
    txtAmount: session.txtAmount || "",
  });

  if (session.chatId) params.set("chatId", String(session.chatId));
  return `/sutd/webapp?${params.toString()}`;
}

router.post("/webapp/notify", express.json(), async (req, res) => {
  try {
    const { token } = req.body;
    const session = getPaymentSession(token);
    if (!session || !session.chatId) return res.json({ ok: true });
    if (session.notifiedAt) return res.json({ ok: true });
    if (session.status === "pending") return res.json({ ok: true });

    await sendPaymentNotification(getPaymentBot("sutd"), session);
  } catch (err) {
    console.error("notify error", err);
  }
  return res.json({ ok: true });
});

router.get("/webapp", async (req, res) => {
  const { txtMtrId, txtAmount, chatId } = req.query;
  const inputError = sutdValidationError({ txtMtrId, txtAmount });

  if (inputError) return res.status(400).send(errorPage(inputError));

  try {
    const meterSummary = await getSutdMeterSummary(txtMtrId);
    track("webapp_opened", {
      route: "sutd",
      meterId: txtMtrId,
      amount: txtAmount,
      ua: req.get("user-agent"),
    });

    const qs = new URLSearchParams({
      txtMtrId,
      txtAmount,
      chatId: chatId || "",
      address: meterSummary.address || "",
      balance: String(meterSummary.credit_bal ?? ""),
    }).toString();

    return res.redirect(`/app/sutd/loading?${qs}`);
  } catch {
    const qs = new URLSearchParams({
      txtMtrId,
      txtAmount,
      chatId: chatId || "",
    }).toString();

    return res.redirect(`/app/sutd/loading?${qs}`);
  }
});

router.get("/webapp/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount, chatId } = req.query;
  const inputError = sutdValidationError({ txtMtrId, txtAmount });

  if (inputError) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      code: "INVALID_INPUT",
      error: inputError,
    });
  }

  try {
    const [out, meterSummary] = await Promise.all([
      runSutdPurchaseFlow({ txtMtrId, txtAmount }),
      getSutdMeterSummary(txtMtrId).catch(() => ({
        address: "",
        credit_bal: "",
      })),
    ]);

    track("bootstrap_started", {
      route: "sutd",
      meterId: txtMtrId,
      amount: txtAmount,
    });

    if (!out?.ok) {
      const error =
        out.loginResult === "invalid"
          ? "Meter ID not found. Please check that you entered the 8-digit SUTD meter ID correctly."
          : out.stage === "select_offer"
            ? "Invalid amount. Please enter an amount between $10.00 and $50.00."
            : out.error ||
              "Failed to initialise SUTD payment flow. Please try again.";

      track("bootstrap_failed", {
        route: "sutd",
        meterId: txtMtrId,
        amount: txtAmount,
        stage: out.stage,
        error,
      });

      return res.status(502).json({ ...out, error });
    }

    const enetsHtml = String(out.enetsBody || "");
    const $ = cheerio.load(enetsHtml);

    const netsMid = extractHiddenField(enetsHtml, "netsMid");
    const e = extractHiddenField(enetsHtml, "e");
    const n = extractHiddenField(enetsHtml, "n");
    const netsTxnRef = extractHiddenField(enetsHtml, "netsTxnRef");
    const merchantTxnRef =
      out.merchant_txn_ref ||
      extractHiddenField(enetsHtml, "merchant_txn_ref") ||
      extractMerchantTxnRef(enetsHtml);
    const rawActionUrl =
      $("form").first().attr("action") || "/enets2/PaymentListener.do";
    const actionUrl = new URL(rawActionUrl, "https://www.enets.sg").toString();

    if (!n || !e || !netsMid || !netsTxnRef) {
      return res
        .status(502)
        .json({ ok: false, error: "Missing eNETS key fields." });
    }

    const token = createPaymentSession({
      txtMtrId,
      txtAmount,
      chatId: chatId || null,
      address: out.address || meterSummary.address || "",
      balance: String(meterSummary.credit_bal ?? ""),
      nets: { n, e, netsMid, netsTxnRef, merchantTxnRef, actionUrl },
      status: "pending",
    });

    track("bootstrap_succeeded", {
      route: "sutd",
      meterId: txtMtrId,
      amount: txtAmount,
      stage: out.stage,
    });

    return res.status(200).json({
      ok: true,
      stage: out.stage,
      redirectUrl: `/sutd/webapp/pay?token=${token}`,
    });
  } catch (err) {
    captureException(err, String(txtMtrId || "anonymous"), {
      route: "sutd",
      endpoint: "/webapp/bootstrap",
    });
    return res.status(500).json({
      ok: false,
      stage: "init",
      error: err.message || "Unknown error",
    });
  }
});

router.get("/webapp/pay", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(errorPage("Missing payment token."));

  const session = getPaymentSession(token);
  if (!session) {
    return res
      .status(400)
      .send(
        errorPage("Payment session expired or invalid. Please start again."),
      );
  }

  const qs = new URLSearchParams({
    token,
    restartUrl: buildRestartUrl(session),
  }).toString();

  return res.redirect(`/app/sutd/pay?${qs}`);
});

router.get("/webapp/result", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(errorPage("Missing result token."));

  const session = getPaymentSession(token);
  if (!session) {
    return res
      .status(400)
      .send(
        errorPage(
          "Session expired. Check your meter balance to confirm payment.",
        ),
      );
  }

  return res.redirect(`/app/sutd/result?token=${encodeURIComponent(token)}`);
});

router.get("/webapp/session", (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ ok: false, error: "Missing token." });
  }

  const session = getPaymentSession(token);
  if (!session) {
    return res.status(400).json({ ok: false, error: "Session expired." });
  }

  const {
    txtMtrId,
    txtAmount,
    address,
    balance,
    nets,
    status,
    reason,
    merchantTxnRef,
    receiptId,
    chatId,
  } = session;

  return res.json({
    ok: true,
    txtMtrId,
    txtAmount,
    address: address || "",
    balance: balance || "",
    status,
    reason: reason || "",
    merchantTxnRef: merchantTxnRef || "",
    receiptAvailable: !!receiptId,
    chatId: chatId || "",
    ...nets,
  });
});

router.get("/webapp/balance", async (req, res) => {
  const { token } = req.query;
  const session = getPaymentSession(token);
  if (!session?.txtMtrId) {
    return res.status(400).json({ ok: false, error: "Session expired." });
  }

  try {
    const summary = await getSutdMeterSummary(session.txtMtrId);
    track("balance_verified", {
      meterId: session.txtMtrId,
      route: "sutd",
      balance: String(summary.credit_bal ?? ""),
    });
    return res.json({
      ok: true,
      txtMtrId: session.txtMtrId,
      address: summary.address || session.address || "",
      balance: summary.credit_bal ?? "",
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    captureException(err, String(session.txtMtrId || "anonymous"), {
      route: "sutd",
      endpoint: "/webapp/balance",
    });
    return res.status(502).json({
      ok: false,
      error: "Unable to fetch the latest balance. Please try again.",
    });
  }
});

router.post(
  "/webapp/enets_pay",
  express.urlencoded({ extended: false, limit: "10mb" }),
  async (req, res) => {
    let meterId;
    let releaseSubmitLock = null;
    try {
      const { token } = req.body;
      const session = getPaymentSession(token);
      if (!session) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid or expired payment session." });
      }

      const {
        txtMtrId,
        txtAmount: amount,
        address,
        balance,
        nets = {},
      } = session;

      meterId = txtMtrId;

      const merchantTxnRef =
        nets.merchantTxnRef || req.body.merchantTxnRef || "";
      const submitLockKey = getPaymentSubmitLockKey({
        route: "sutd",
        merchantTxnRef,
        token,
      });
      releaseSubmitLock = acquirePaymentSubmitLock(submitLockKey);
      if (!releaseSubmitLock) {
        track("payment_duplicate_blocked", {
          meterId,
          merchantTxnRef,
          route: "sutd",
        });
        return res.status(409).json({
          ok: false,
          code: "PAYMENT_ALREADY_PROCESSING",
          error: "Payment is already processing. Please wait for the result.",
        });
      }

      const paymentBody = new URLSearchParams(req.body);
      if (nets.e) paymentBody.set("e", String(nets.e));
      if (nets.n) paymentBody.set("n", String(nets.n));
      if (nets.netsMid) paymentBody.set("netsMid", String(nets.netsMid));
      if (nets.netsTxnRef) {
        paymentBody.set("netsTxnRef", String(nets.netsTxnRef));
      }
      if (merchantTxnRef) {
        paymentBody.set("merchantTxnRef", String(merchantTxnRef));
      }

      track("payment_attempted", {
        route: "sutd",
        meterId,
        amount,
        merchantTxnRef,
      });

      const enetsResp = await axios.post(
        "https://www.enets.sg/GW2/uCredit/pay",
        paymentBody.toString(),
        {
          headers: {
            ...DEFAULT_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://www.enets.sg",
            Referer: "https://www.enets.sg/enets2/PaymentListener.do",
          },
          validateStatus: () => true,
          maxRedirects: 5,
        },
      );

      const html = String(enetsResp.data || "");
      const evsCb = extractEvsCallbackFromHtml(html);

      if (evsCb) {
        const jsessionid =
          req.body.jsessionid ||
          req.headers.cookie?.match(/(?:^|;\s*)JSESSIONID=([^;]+)/i)?.[1] ||
          null;

        const evsResult = await postSutdResultToEvs({
          status: evsCb.status,
          id: evsCb.id,
          message: evsCb.message,
          jsessionid,
        });

        const parsed = evsResult.parsed || {};
        const normalized = normalizeFinalOutcome(parsed);

        session.status = normalized.status;
        session.merchantTxnRef =
          normalized.merchantTxnRef || evsCb.id || merchantTxnRef || "";
        session.reason = normalized.reason || "";
        session.completedAt = Date.now();

        const resultToken = await createNotifiedResultToken(session, {
          status: session.status,
          merchantTxnRef: session.merchantTxnRef,
          reason: session.reason,
          source: "sutd_transsum",
          completedAt: session.completedAt,
        });

        track(
          normalized.status === "success"
            ? "payment_completed"
            : "payment_failed",
          {
            route: "sutd",
            meterId,
            amount,
            merchantTxnRef: session.merchantTxnRef,
            status: normalized.status,
            reason: normalized.reason || "",
          },
        );

        return res.status(200).json({
          ok: true,
          resultToken,
          source: "sutd_transsum",
          status: normalized.status || "unknown",
          merchantTxnRef: session.merchantTxnRef,
          meterId: meterId || normalized.meterId || "",
          address: address || "",
          balance: balance || "",
          amount: amount || normalized.amount || "",
          reason: normalized.reason || "",
          upstreamStatus: {
            enets: enetsResp.status,
            evs: evsResult.upstreamStatus,
          },
        });
      }

      const receipt = parseEnetsResult(html);
      if (!receipt) {
        return res.status(502).json({
          ok: false,
          error: "Could not parse eNETS response or SUTD callback form",
          preview: html.slice(0, 1200),
        });
      }

      const normalized = normalizeFinalOutcome(receipt);

      session.status = normalized.status;
      session.merchantTxnRef = receipt.merchantTxnRef || merchantTxnRef || "";
      session.reason = normalized.reason || "";
      session.completedAt = Date.now();

      const resultToken = await createNotifiedResultToken(session, {
        status: session.status,
        merchantTxnRef: session.merchantTxnRef,
        reason: session.reason,
        source: "enets_receipt_fallback",
        completedAt: session.completedAt,
      });

      return res.status(200).json({
        ok: true,
        resultToken,
        source: "enets_receipt_fallback",
        status: normalized.status,
        merchantTxnRef: session.merchantTxnRef,
        meterId,
        address,
        balance,
        amount,
        reason: normalized.reason || "",
      });
    } catch (err) {
      captureException(err, String(meterId || "anonymous"), {
        route: "sutd",
        endpoint: "/webapp/enets_pay",
      });
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      releaseSubmitLock?.();
    }
  },
);

module.exports = router;
