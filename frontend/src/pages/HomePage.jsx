import { useEffect, useState } from "react";
import { Card, DetailRow, Logo } from "../components/Card";
import styles from "./HomePage.module.css";

const STORAGE_KEY = "nusaircon:webProfile";

const HOSTEL_GROUPS = [
  {
    label: "PGPR, Houses @ PGP, Residential Colleges, NUS College",
    basePath: "",
    loadingPath: "/loading",
  },
  {
    label: "UTown Residence, RVRC",
    basePath: "/cp2nus",
    loadingPath: "/cp2nus/loading",
  },
];

const MODES = [
  { id: "topup", label: "Top Up" },
  { id: "balance", label: "Balance" },
  { id: "usage", label: "Usage" },
  { id: "topups", label: "Top-ups" },
  { id: "feedback", label: "Feedback" },
];

function isValidMeterId(v) {
  return /^\d{8}$/.test(String(v || "").trim());
}

function isValidAmount(v) {
  const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 6 && n <= 50;
}

function readSavedProfile() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !isValidMeterId(parsed.meterId)) return null;
    if (!HOSTEL_GROUPS[parsed.groupIndex]) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private browsing; continue without saving.
  }
}

function clearSavedProfile() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function parseMoney(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatSignedMoney(value) {
  const n = parseMoney(value);
  return n === null ? "Unavailable" : `SGD ${n.toFixed(2)}`;
}

function formatCostMoney(value) {
  const n = parseMoney(value);
  return n === null ? "Unavailable" : `SGD ${Math.abs(n).toFixed(2)}`;
}

function formatDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)
    ? raw.replace(" ", "T") + (raw.endsWith("Z") ? "" : "+08:00")
    : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function SummaryRows({ result }) {
  if (!result) return null;

  return (
    <div className={styles.summaryRows}>
      <DetailRow label="Meter ID" value={result.meterId || "-"} />
      {result.address && <DetailRow label="Address" value={result.address} />}
      <DetailRow label="Balance" value={formatSignedMoney(result.balance)} />
      {result.checkedAt && (
        <DetailRow label="Checked" value={formatDate(result.checkedAt)} />
      )}
    </div>
  );
}

function UsageResult({ result }) {
  const usage = result?.usage;
  if (!usage) return null;

  const analysis = usage.analysis || {};
  const rows = (usage.history || []).filter((row) => row.amount !== null);
  const rank = usage.rank;
  const rankPct =
    rank?.rank_val !== undefined && Number.isFinite(Number(rank.rank_val))
      ? Math.max(0, Math.min(100, 100 - Number(rank.rank_val) * 100)).toFixed(0)
      : null;

  return (
    <>
      <div className={styles.metricGrid}>
        <div>
          <span>Yesterday</span>
          <strong>{formatCostMoney(analysis.lastDay)}</strong>
        </div>
        <div>
          <span>7-day avg</span>
          <strong>{formatCostMoney(analysis.avgDaily)}</strong>
        </div>
        <div>
          <span>7-day total</span>
          <strong>{formatCostMoney(analysis.total)}</strong>
        </div>
        <div>
          <span>This month</span>
          <strong>{formatCostMoney(usage.monthToDate)}</strong>
        </div>
      </div>

      {rankPct && (
        <div className={styles.note}>
          Building rank: top {rankPct}% by recent daily usage.
        </div>
      )}

      {analysis.warnings?.length > 0 && (
        <div className={styles.warningList}>
          {analysis.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      <div className={styles.historyList}>
        {rows.length ? (
          rows.map((row, index) => (
            <div className={styles.historyRow} key={`${row.date}-${index}`}>
              <span>{formatDate(row.date) || `Day ${index + 1}`}</span>
              <strong>{formatCostMoney(row.amount)}</strong>
            </div>
          ))
        ) : (
          <div className={styles.emptyState}>No usage data available.</div>
        )}
      </div>
    </>
  );
}

function TopupsResult({ result }) {
  const rows = result?.topups?.history || [];

  return (
    <div className={styles.historyList}>
      {rows.length ? (
        rows.map((row, index) => (
          <div className={styles.historyRow} key={`${row.reference}-${index}`}>
            <span>
              {formatDate(row.date) || "Date unavailable"}
              {row.reference ? (
                <small>Reference {row.reference}</small>
              ) : null}
            </span>
            <strong>{formatCostMoney(row.amount)}</strong>
          </div>
        ))
      ) : (
        <div className={styles.emptyState}>
          No top-ups found in the last 90 days.
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [activeMode, setActiveMode] = useState("topup");
  const [groupIndex, setGroupIndex] = useState(null);
  const [meterId, setMeterId] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState({});
  const [savedProfile, setSavedProfile] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    const saved = readSavedProfile();
    if (!saved) return;
    setSavedProfile(saved);
    setGroupIndex(saved.groupIndex);
    setMeterId(saved.meterId);
  }, []);

  function validateTopUp() {
    const e = {};
    if (groupIndex === null) e.group = "Please select your hostel";
    if (!isValidMeterId(meterId)) e.meterId = "Must be exactly 8 digits";
    if (!isValidAmount(amount)) e.amount = "Between $6.00 and $50.00";
    return e;
  }

  function validateLookup() {
    if (!isValidMeterId(meterId)) {
      setErrors({ meterId: "Must be exactly 8 digits" });
      return false;
    }
    setErrors({});
    return true;
  }

  function handleMeterChange(value) {
    setMeterId(value.replace(/\D/g, "").slice(0, 8));
    if (errors.meterId) setErrors((p) => ({ ...p, meterId: undefined }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validateTopUp();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    const group = HOSTEL_GROUPS[groupIndex];
    const cleanMeterId = meterId.trim();
    saveProfile({ groupIndex, meterId: cleanMeterId });
    setSavedProfile({ groupIndex, meterId: cleanMeterId });

    const qs = new URLSearchParams({
      txtMtrId: cleanMeterId,
      txtAmount: amount.trim(),
    }).toString();

    window.location.href = `${group.basePath}/webapp?${qs}`;
  }

  async function handleLookupSubmit(e) {
    e.preventDefault();
    if (!validateLookup()) return;

    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);

    try {
      const qs = new URLSearchParams({
        meterId: meterId.trim(),
        mode: activeMode,
      }).toString();
      const resp = await fetch(`/website/lookup?${qs}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || "Unable to fetch meter details.");
      }
      setLookupResult(data);
    } catch (err) {
      setLookupError(err.message || "Unable to fetch meter details.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleFeedbackSubmit(e) {
    e.preventDefault();
    setFeedbackLoading(true);
    setFeedbackStatus("");

    try {
      const resp = await fetch("/website/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          message: feedbackMessage,
          contact: feedbackContact,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || "Unable to submit feedback.");
      }
      setFeedbackMessage("");
      setFeedbackContact("");
      setFeedbackStatus("Thanks for your feedback.");
    } catch (err) {
      setFeedbackStatus(err.message || "Unable to submit feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }

  function handleForgetSaved() {
    clearSavedProfile();
    setSavedProfile(null);
    setGroupIndex(null);
    setMeterId("");
  }

  function handleCancel() {
    setErrors({});
    setLookupError("");
    setLookupResult(null);
    setFeedbackStatus("");
    setFeedbackMessage("");
    setFeedbackContact("");
    setAmount("");
    setActiveMode("topup");
  }

  const isLookupMode = ["balance", "usage", "topups"].includes(activeMode);

  return (
    <Card align="left" className={styles.homeCard}>
      <Logo>⚡</Logo>
      <h1 className={styles.title}>Electricity Top-Up</h1>
      <p className={styles.sub}>
        Top up, check your meter, or send feedback from one place.
      </p>

      <div className={styles.modeTabs} role="tablist" aria-label="Website tools">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={[
              styles.modeTab,
              activeMode === mode.id ? styles.modeTabActive : "",
            ].join(" ")}
            onClick={() => {
              setActiveMode(mode.id);
              setErrors({});
              setLookupError("");
              setLookupResult(null);
              setFeedbackStatus("");
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {savedProfile && (
        <div className={styles.savedBar}>
          <span>
            Saved meter {savedProfile.meterId} ·{" "}
            {HOSTEL_GROUPS[savedProfile.groupIndex].label}
          </span>
          <button type="button" onClick={handleForgetSaved}>
            Forget saved
          </button>
        </div>
      )}

      <details className={styles.helpBox}>
        <summary>Help</summary>
        <div className={styles.helpContent}>
          <p>
            Supported hostels: PGPR, Houses at PGP, Residential Colleges, NUS
            College, UTown Residence, and RVRC.
          </p>
          <p>Accepted top-up amount: SGD 6.00 to SGD 50.00.</p>
        </div>
      </details>

      {activeMode === "topup" && (
        <form onSubmit={handleSubmit} autoComplete="off" noValidate>
          <div className={styles.field}>
            <label className={styles.label}>Hostel</label>
            <div className={styles.groupList}>
              {HOSTEL_GROUPS.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  className={[
                    styles.groupBtn,
                    groupIndex === i ? styles.groupBtnActive : "",
                  ].join(" ")}
                  onClick={() => {
                    setGroupIndex(i);
                    setErrors((p) => ({ ...p, group: undefined }));
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {errors.group && (
              <div className={styles.errMsg}>{errors.group}</div>
            )}
          </div>

          <MeterField
            meterId={meterId}
            error={errors.meterId}
            onChange={handleMeterChange}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="amount">
              Amount (SGD)
            </label>
            <div className={styles.amountWrap}>
              <span className={styles.currency}>$</span>
              <input
                id="amount"
                className={[
                  styles.input,
                  styles.amountInput,
                  errors.amount ? styles.inputError : "",
                ].join(" ")}
                type="number"
                inputMode="decimal"
                min="6"
                max="50"
                step="0.01"
                placeholder="6.00 - 50.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount)
                    setErrors((p) => ({ ...p, amount: undefined }));
                }}
              />
            </div>
            {errors.amount && (
              <div className={styles.errMsg}>{errors.amount}</div>
            )}
          </div>

          <div className={styles.presets}>
            {[10, 20, 30, 50].map((v) => (
              <button
                key={v}
                type="button"
                className={[
                  styles.preset,
                  amount === String(v) ? styles.presetActive : "",
                ].join(" ")}
                onClick={() => {
                  setAmount(String(v));
                  setErrors((p) => ({ ...p, amount: undefined }));
                }}
              >
                ${v}
              </button>
            ))}
          </div>

          <div className={styles.actionGrid}>
            <button type="submit" className={styles.btn}>
              Continue
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>

          <p className={styles.hint}>
            Payment is processed securely via eNETS. Your card details are
            RSA-encrypted before leaving your device.{" "}
            <a href="/app/terms">Terms of Use</a>
          </p>
        </form>
      )}

      {isLookupMode && (
        <form onSubmit={handleLookupSubmit} autoComplete="off" noValidate>
          <MeterField
            meterId={meterId}
            error={errors.meterId}
            onChange={handleMeterChange}
          />

          <div className={styles.actionGrid}>
            <button type="submit" className={styles.btn}>
              {lookupLoading ? "Checking..." : "Check Meter"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>

          {lookupError && <div className={styles.errorBox}>{lookupError}</div>}
          {lookupResult && (
            <div className={styles.resultPanel}>
              <SummaryRows result={lookupResult} />
              {activeMode === "usage" && <UsageResult result={lookupResult} />}
              {activeMode === "topups" && (
                <TopupsResult result={lookupResult} />
              )}
            </div>
          )}
        </form>
      )}

      {activeMode === "feedback" && (
        <form onSubmit={handleFeedbackSubmit} autoComplete="off">
          <div className={styles.field}>
            <label className={styles.label}>Rating</label>
            <div className={styles.ratingGrid}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  className={[
                    styles.preset,
                    feedbackRating === rating ? styles.presetActive : "",
                  ].join(" ")}
                  onClick={() => setFeedbackRating(rating)}
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedbackMessage">
              Feedback
            </label>
            <textarea
              id="feedbackMessage"
              className={styles.textarea}
              rows={5}
              maxLength={2000}
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              placeholder="What worked, what broke, or what should improve?"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedbackContact">
              Contact (optional)
            </label>
            <input
              id="feedbackContact"
              className={styles.input}
              value={feedbackContact}
              onChange={(e) => setFeedbackContact(e.target.value)}
              placeholder="Telegram handle or email"
            />
          </div>

          <div className={styles.actionGrid}>
            <button type="submit" className={styles.btn}>
              {feedbackLoading ? "Sending..." : "Submit Feedback"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>

          {feedbackStatus && (
            <div className={styles.note}>{feedbackStatus}</div>
          )}
        </form>
      )}
    </Card>
  );
}

function MeterField({ meterId, error, onChange }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="meterId">
        Meter ID
      </label>
      <input
        id="meterId"
        className={[styles.input, error ? styles.inputError : ""].join(" ")}
        type="tel"
        inputMode="numeric"
        maxLength={8}
        placeholder="8-digit meter ID"
        value={meterId}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <div className={styles.errMsg}>{error}</div>}
    </div>
  );
}
