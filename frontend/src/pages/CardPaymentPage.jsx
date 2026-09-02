import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, Logo } from "../components/Card";
import { detectCardBrand, formatCardNumber } from "../lib/cardBrand";
import { validateCardForm } from "../lib/validation";
import { encryptCard } from "../lib/rsa";
import styles from "./CardPaymentPage.module.css";

function useTelegram() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);
}

function safeRestartUrl(value) {
  const fallback = "/app/";
  if (!value) return fallback;

  try {
    const url = new URL(value, window.location.origin);
    const allowedPaths = new Set([
      "/webapp",
      "/cp2nus/webapp",
      "/sutd/webapp",
      "/app",
      "/app/",
    ]);

    if (url.origin !== window.location.origin) return fallback;
    if (!allowedPaths.has(url.pathname)) return fallback;

    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

function getExternalPaymentAction(session) {
  const fallback = "https://www.enets.sg/GW2/uCredit/pay";

  try {
    const url = new URL(session?.actionUrl || fallback);
    const allowedOrigins = new Set([
      "https://www.enets.sg",
      "https://www2.enets.sg",
    ]);

    return allowedOrigins.has(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function submitExternalPostForm(action, fields) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.enctype = "application/x-www-form-urlencoded";
  form.style.display = "none";

  for (const [name, value] of fields.entries()) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({ id, label, error, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <div id={`${id}-error`} className={styles.errMsg}>
          {error}
        </div>
      )}
    </div>
  );
}

function Input({ id, inputRef, error, ...props }) {
  return (
    <input
      id={id}
      ref={inputRef}
      className={[styles.input, error ? styles.inputError : ""].join(" ")}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      {...props}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CardPaymentPage({ basePath = "" }) {
  useTelegram();

  const [searchParams] = useSearchParams();

  const token = searchParams.get("token") || "";
  const restartUrl = safeRestartUrl(searchParams.get("restartUrl"));

  const initialLoadErr = token
    ? null
    : { message: "Missing payment token.", expired: false };

  // Session state — fetched from /webapp/session
  // loadErr shape: { message: string, expired: boolean } | null
  const [session, setSession] = useState(null);
  const [loadErr, setLoadErr] = useState(initialLoadErr);

  // Form state
  const [fields, setFields] = useState({
    name: "",
    email: "",
    cardNo: "",
    expMth: "",
    expYr: "",
    cvv: "",
  });
  const [errors, setErrors] = useState({});
  const [brand, setBrand] = useState(""); // 'visa' | 'mastercard' | ''
  const [globalError, setGlobalError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [btnLabel, setBtnLabel] = useState("");

  const [debugActive, setDebugActive] = useState(0);
  const lastTapRef = useRef(0);

  // Refs for auto-focus chaining
  const expMthRef = useRef(null);
  const expYrRef = useRef(null);
  const cvvRef = useRef(null);
  const pressTimer = useRef(null);

  function handlePressStart() {
    pressTimer.current = setTimeout(
      () => setDebugActive((v) => (v ? 0 : 1)),
      1000,
    );
  }

  function handlePressEnd() {
    clearTimeout(pressTimer.current);
  }

  // ── Load session from Express ───────────────────────────────────────────────
  // paymentSession.js TTL is 10 minutes. Expiry at this point is unlikely
  // (bootstrap just ran) but possible on a stale link or slow device.
  // On expiry (HTTP 400) we show a restart prompt rather than a dead error.
  useEffect(() => {
    if (loadErr) return;

    fetch(`${basePath}/webapp/session?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!data.ok) {
          const expired = r.status === 400;
          const err = new Error(data.error || "Session load failed");
          err.expired = expired;
          throw err;
        }
        if (data.tokenKind && data.tokenKind !== "payment") {
          const err = new Error("Invalid payment session.");
          err.expired = true;
          throw err;
        }
        return data;
      })
      .then((data) => {
        setSession(data);
        setBtnLabel(`Pay SGD ${Number(data.txtAmount).toFixed(2)}`);
      })
      .catch((err) => {
        setLoadErr({ message: err.message, expired: !!err.expired });
      });
    // loadErr intentionally excluded — we only want this to run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, token]);

  // ── Field change handler ────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target;
    setFields((f) => ({ ...f, [name]: value }));
    // clear error on edit
    if (errors[name])
      setErrors((e) => {
        const n = { ...e };
        delete n[name];
        return n;
      });
  }

  function handleCardNo(e) {
    const raw = e.target.value.replace(/\D/g, "").substring(0, 16);
    const formatted = formatCardNumber(raw);
    setFields((f) => ({ ...f, cardNo: formatted }));
    setBrand(detectCardBrand(raw));
    if (errors.cardNo)
      setErrors((e) => {
        const n = { ...e };
        delete n.cardNo;
        return n;
      });
  }

  // Pre-bind focus-chain handlers with useCallback so refs are only accessed
  // inside the callback body (event time), never during render.
  const handleExpMthChange = useCallback((e) => {
    const raw = e.target.value.replace(/\D/g, "");
    setFields((f) => ({ ...f, expMth: e.target.value }));
    setErrors((prev) => {
      if (!prev.expMth) return prev;
      const next = { ...prev };
      delete next.expMth;
      return next;
    });
    if (raw.length >= 2) expYrRef.current?.focus();
  }, []);

  const handleExpYrChange = useCallback((e) => {
    const raw = e.target.value.replace(/\D/g, "");
    setFields((f) => ({ ...f, expYr: e.target.value }));
    setErrors((prev) => {
      if (!prev.expYr) return prev;
      const next = { ...prev };
      delete next.expYr;
      return next;
    });
    if (raw.length >= 2) cvvRef.current?.focus();
  }, []);

  const handleExpYrKeyDown = useCallback((e) => {
    if (e.key === "Backspace" && !e.target.value) expMthRef.current?.focus();
  }, []);

  const handleCvvKeyDown = useCallback((e) => {
    if (e.key === "Backspace" && !e.target.value) expYrRef.current?.focus();
  }, []);

  function handleRestart() {
    window.location.href = restartUrl;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    setGlobalError(null);

    const result = validateCardForm(fields);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    setSubmitting(true);
    setBtnLabel("Encrypting…");

    try {
      const { name, email, card, mth, yr, cvv } = result.data;
      const {
        rsaModulus,
        rsaExponent, // cp2nus keys
        n,
        e, // cp2 keys
        netsMid,
        paymtNetsMid,
        netsTxnRef,
        merchantTxnRef,
        txnRand = "",
        keyId = "",
        hmac = "",
        txtAmount,
        txtMtrId: meterId,
        address = "",
        balance = "",
      } = session;

      const modulus = rsaModulus || n;
      const exponent = rsaExponent || e;
      const enc = encryptCard(modulus, exponent, card, cvv);

      const amtCents = String(Math.round(Number(txtAmount) * 100));

      const enetsFields = {
        browserJavaEnabled: "false",
        browserJavaScriptEnabled: "true",
        browserLanguage: navigator.language || "en-US",
        browserColorDepth: String(screen.colorDepth || 24),
        browserScreenHeight: String(window.innerHeight),
        browserScreenWidth: String(window.innerWidth),
        browserTz: String(new Date().getTimezoneOffset()),
        browserUserAgent: navigator.userAgent,
        enc,
        pageId: "payment_page",
        button: "submit",
        e: exponent || "",
        n: modulus || "",
        netsMid: paymtNetsMid || netsMid,
        netsTxnRef: netsTxnRef || "",
        merchantTxnRef: merchantTxnRef || "",
        currencyCode: "SGD",
        txnAmount: amtCents,
        name,
        expiryMonth: mth,
        expiryYear: "20" + yr,
        consumerEmail: email,
        cardNo: "*".repeat(card.length),
        cvv: "*".repeat(cvv.length),
        agree: "Y",
        x: "0",
        y: "0",
      };

      if (basePath === "/sutd") {
        setBtnLabel("Opening eNETS…");
        submitExternalPostForm(
          getExternalPaymentAction(session),
          new URLSearchParams(enetsFields),
        );
        return;
      }

      const payload = new URLSearchParams({
        token,
        ...enetsFields,
        txnRand,
        keyId,
        hmac,
        imgPayMode: "on",
        meterId,
        address,
        balance,
        amount: `S$ ${Number(txtAmount).toFixed(2)}`,
        debug: String(debugActive),
      });

      setBtnLabel("Processing…");

      const resp = await fetch(`${basePath}/webapp/enets_pay`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString(),
      });

      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || !out.ok) {
        const err = new Error(out.error || "Payment request failed");
        // Propagate expired signal so the catch block can show restart prompt
        if (resp.status === 400)
          err.message = out.error || "Invalid or expired payment session.";
        throw err;
      }

      const resultToken = out.resultToken || token;
      window.location.href = `${basePath}/webapp/result?token=${encodeURIComponent(resultToken)}`;
    } catch (err) {
      // A 400 from enets_pay mid-submit means the session expired during form fill.
      // Surface a restart prompt rather than a generic error.
      if (
        err.message?.toLowerCase().includes("expired") ||
        err.message?.toLowerCase().includes("invalid or expired")
      ) {
        setLoadErr({
          message: "Your payment session expired. Please start again.",
          expired: true,
        });
        return;
      }
      setGlobalError(err.message || "Encryption error");
      setBtnLabel(`Pay SGD ${Number(session?.txtAmount || 0).toFixed(2)}`);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render: loading / error / form ─────────────────────────────────────────

  if (loadErr) {
    return (
      <Card align="center">
        <span
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          style={{ cursor: "pointer", userSelect: "none" }}
        >
          <Logo>{debugActive ? "🔓" : "⚡"}</Logo>
        </span>
        <div className={styles.loadErr}>{loadErr.message}</div>
        {loadErr.expired && (
          <>
            <p className={styles.loadErrHint}>
              Your session expired. Start a new top-up to continue.
            </p>
            <button className={styles.btn} onClick={handleRestart}>
              Start Again
            </button>
          </>
        )}
      </Card>
    );
  }

  if (!session) {
    return (
      <Card align="center">
        <span
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          style={{ cursor: "pointer", userSelect: "none" }}
        >
          <Logo>{debugActive ? "🔓" : "⚡"}</Logo>
        </span>
        <div className={styles.spinner} />
      </Card>
    );
  }

  const amtDisplay = Number(session.txtAmount).toFixed(2);

  return (
    <Card align="left">
      <span
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerLeave={handlePressEnd}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <Logo>{debugActive ? "🔓" : "⚡"}</Logo>
      </span>
      <h1 className={styles.title}>Card payment</h1>
      <p className={styles.sub}>
        Details are RSA-encrypted before leaving your device.
      </p>
      <div className={styles.summary}>
        <span>
          Meter <span className={styles.summaryMono}>{session.txtMtrId}</span>
        </span>
        <span className={styles.summaryVal}>SGD {amtDisplay}</span>
      </div>
      <form onSubmit={handleSubmit} autoComplete="off">
        <Field id="name" label="Cardholder name" error={errors.name}>
          <Input
            id="name"
            name="name"
            type="text"
            value={fields.name}
            placeholder="As printed on card"
            autoComplete="cc-name"
            error={errors.name}
            onChange={handleChange}
            style={{ fontFamily: "var(--sans)" }}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            value={fields.email}
            placeholder="you@example.com"
            autoComplete="email"
            error={errors.email}
            onChange={handleChange}
            style={{ fontFamily: "var(--sans)" }}
          />
        </Field>
        <Field id="cardNo" label="Card number" error={errors.cardNo}>
          <div className={styles.cardNumberWrap}>
            <Input
              id="cardNo"
              name="cardNo"
              type="tel"
              value={fields.cardNo}
              placeholder="•••• •••• •••• ••••"
              maxLength={19}
              autoComplete="cc-number"
              inputMode="numeric"
              error={errors.cardNo}
              onChange={handleCardNo}
            />
            <span
              className={[
                styles.cardBrandIcon,
                brand ? styles[brand] : "",
              ].join(" ")}
              aria-label={brand || undefined}
            />
          </div>
        </Field>
        <div className={styles.row3}>
          <Field id="expMth" label="Month" error={errors.expMth}>
            <Input
              id="expMth"
              name="expMth"
              type="tel"
              value={fields.expMth}
              placeholder="MM"
              maxLength={2}
              inputMode="numeric"
              error={errors.expMth}
              inputRef={expMthRef}
              onChange={handleExpMthChange}
            />
          </Field>

          <Field id="expYr" label="Year" error={errors.expYr}>
            <Input
              id="expYr"
              name="expYr"
              type="tel"
              value={fields.expYr}
              placeholder="YY"
              maxLength={2}
              inputMode="numeric"
              error={errors.expYr}
              inputRef={expYrRef}
              onChange={handleExpYrChange}
              onKeyDown={handleExpYrKeyDown}
            />
          </Field>

          <Field id="cvv" label="CVV" error={errors.cvv}>
            <div className={styles.cvvWrap}>
              <Input
                id="cvv"
                name="cvv"
                type="tel"
                value={fields.cvv}
                placeholder="•••"
                maxLength={4}
                inputMode="numeric"
                error={errors.cvv}
                inputRef={cvvRef}
                onChange={handleChange}
                onKeyDown={handleCvvKeyDown}
              />
              <span className={styles.cvvIcon} />
            </div>
          </Field>
        </div>
        {globalError && (
          <div className={styles.globalError}>⚠️ {globalError}</div>
        )}
        <button type="submit" className={styles.btn} disabled={submitting}>
          {btnLabel}
        </button>
        <p className={styles.lock}>
          🔒 eNETS RSA-encrypted · Powered by eNETS ·{" "}
          <a href="/app/terms">Terms</a>
        </p>{" "}
      </form>
    </Card>
  );
}
