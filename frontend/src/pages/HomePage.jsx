import { useEffect, useState } from "react";
import { Card, DetailRow, Logo } from "../components/Card";
import styles from "./HomePage.module.css";

const STORAGE_KEY = "evs:webProfile";
const LEGACY_STORAGE_KEYS = ["nusaircon:webProfile"];
const MAX_SAVED_METERS = 6;
const RECOMMENDATION_DAYS = 10;
const MIN_TOPUP_AMOUNT = 6;
const MAX_TOPUP_AMOUNT = 50;

const HOSTEL_GROUPS = [
  {
    label:
      "PGPR, Houses @ PGP except Valour House, Residential Colleges, NUS College",
    id: "cp2",
    basePath: "",
    loadingPath: "/loading",
    topupSupported: true,
    usageSupported: true,
    minAmount: 6,
    maxAmount: 50,
  },
  {
    label: "UTown Residence, RVRC, Valour House",
    id: "cp2nus",
    basePath: "/cp2nus",
    loadingPath: "/cp2nus/loading",
    topupSupported: true,
    usageSupported: true,
    minAmount: 6,
    maxAmount: 50,
  },
  {
    label: "SUTD",
    id: "sutd",
    basePath: "/sutd",
    loadingPath: "/sutd/loading",
    topupSupported: true,
    usageSupported: false,
    minAmount: 10,
    maxAmount: 50,
  },
];

const MODES = [
  { id: "topup", label: "Top Up" },
  { id: "balance", label: "Balance" },
  { id: "usage", label: "Usage" },
  { id: "topups", label: "Top-ups" },
  { id: "feedback", label: "Feedback" },
];

const LANDING_COPY = {
  default: {
    title: "NUS and SUTD EVS Top Up",
    subtitle:
      "Check supported EVS meter balances, usage, top-up history, or start a secure NUS or SUTD top-up from one place.",
  },
  cp2: {
    title: "PGPR, PGP Houses and NUS College EVS Top Up",
    subtitle:
      "Use the CP2 EVS system for PGPR, Houses at PGP except Valour House, Residential Colleges, and NUS College balance checks, usage, top-up history, and top-ups.",
  },
  cp2nus: {
    title: "UTown, RVRC and Valour House EVS Top Up",
    subtitle:
      "Use the CP2NUS EVS system for UTown Residence, RVRC, and Valour House meter balance checks, usage, top-up history, and top-ups.",
  },
  balance: {
    title: "EVS Meter Balance Check",
    subtitle:
      "Check supported NUS and SUTD EVS meter balances online before starting a top-up.",
  },
  sutd: {
    title: "SUTD EVS Top Up",
    subtitle:
      "Check SUTD EVS meter balance and top-up history, or start a secure SUTD meter top-up.",
  },
};

function getLandingCopy(initialGroupId) {
  return LANDING_COPY[initialGroupId] || LANDING_COPY.default;
}

function normalizeInitialMode(initialMode) {
  const mode = String(initialMode || "").trim();
  return MODES.some((item) => item.id === mode) ? mode : "topup";
}

function isValidMeterId(v) {
  return /^\d{8}$/.test(String(v || "").trim());
}

function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const match = /^(?:S\$\s*|\$\s*)?(\d+(?:\.\d{1,2})?)$/i.exec(
    String(v ?? "").trim(),
  );
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function isValidAmount(v, group = null) {
  const n = parseAmount(v);
  const min = group?.minAmount ?? MIN_TOPUP_AMOUNT;
  const max = group?.maxAmount ?? MAX_TOPUP_AMOUNT;
  return n !== null && n >= min && n <= max;
}

function amountRangeLabel(group = null) {
  const min = group?.minAmount ?? MIN_TOPUP_AMOUNT;
  const max = group?.maxAmount ?? MAX_TOPUP_AMOUNT;
  return `$${min.toFixed(2)} and $${max.toFixed(2)}`;
}

function readRuntimeTopupStatus() {
  if (typeof window === "undefined") return null;
  const status = window.__EVS_RUNTIME_CONFIG__?.topup;
  return status && typeof status === "object" ? status : null;
}

function topupStatusKey(group) {
  return group?.id === "sutd" ? "sutd" : "nus";
}

function getTopupDisabledMessage(group, topupStatus) {
  if (!group || !topupStatus) return "";
  const status = topupStatus[topupStatusKey(group)];
  return status?.disabled ? status.message || "Top-ups are unavailable." : "";
}

function getProfileId(groupIndex, meterId) {
  return `${groupIndex}:${meterId}`;
}

function sanitizeMeterLabel(label, meterId) {
  const clean = String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return clean || `Meter ${String(meterId).slice(-4)}`;
}

function normalizeSavedProfile(profile) {
  const meterId = String(profile?.meterId || "").trim();
  const groupIndex = Number(profile?.groupIndex);
  if (!isValidMeterId(meterId) || !HOSTEL_GROUPS[groupIndex]) return null;

  return {
    id: getProfileId(groupIndex, meterId),
    label: sanitizeMeterLabel(profile?.label, meterId),
    groupIndex,
    meterId,
    savedAt: Number.isFinite(Number(profile?.savedAt))
      ? Number(profile.savedAt)
      : Date.now(),
  };
}

function dedupeProfiles(profiles) {
  const seen = new Set();
  const next = [];
  for (const profile of profiles) {
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    next.push(profile);
  }
  return next.slice(0, MAX_SAVED_METERS);
}

function readSavedState() {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ||
      LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(
        Boolean,
      );
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed) return { profiles: [], activeId: null };

    if (Array.isArray(parsed.profiles)) {
      const profiles = dedupeProfiles(
        parsed.profiles.map(normalizeSavedProfile),
      );
      const activeId = profiles.some((profile) => profile.id === parsed.activeId)
        ? parsed.activeId
        : profiles[0]?.id || null;
      return { profiles, activeId };
    }

    const migrated = normalizeSavedProfile(parsed);
    return migrated
      ? { profiles: [migrated], activeId: migrated.id }
      : { profiles: [], activeId: null };
  } catch {
    return { profiles: [], activeId: null };
  }
}

function persistSavedState(profiles, activeId) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId,
        profiles,
      }),
    );
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing; continue without saving.
  }
}

function upsertSavedProfile(profiles, profile) {
  return dedupeProfiles([
    profile,
    ...profiles.filter((saved) => saved.id !== profile.id),
  ]);
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

function formatCompactSgd(value) {
  return Number.isInteger(value) ? `SGD ${value}` : `SGD ${value.toFixed(2)}`;
}

function buildTopupRecommendation(result) {
  const avgDaily = parseMoney(result?.usage?.analysis?.avgDaily);
  const balance = parseMoney(result?.balance);
  if (avgDaily === null || avgDaily <= 0 || balance === null) return null;

  const currentDays = balance / avgDaily;
  if (currentDays >= RECOMMENDATION_DAYS) return null;

  const rawAmount = RECOMMENDATION_DAYS * avgDaily - balance;
  const amount = Math.min(
    MAX_TOPUP_AMOUNT,
    Math.max(MIN_TOPUP_AMOUNT, Math.ceil(rawAmount)),
  );
  const projectedDays = Math.max(0, Math.round((balance + amount) / avgDaily));
  const amountLabel = formatCompactSgd(amount);

  return {
    amount,
    amountLabel,
    text:
      projectedDays >= 1
        ? `Top up ${amountLabel} to last about ${projectedDays} day${projectedDays === 1 ? "" : "s"}.`
        : `Top up ${amountLabel} to reduce the negative balance.`,
  };
}

function formatDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dayFirst = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?$/,
  );
  const normalized = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}T${dayFirst[4] || "00:00"}+08:00`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)
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

function UsageResult({ result, onUseRecommendation }) {
  const usage = result?.usage;
  if (!usage) return null;

  const analysis = usage.analysis || {};
  const rows = (usage.history || []).filter((row) => row.amount !== null);
  const recommendation = buildTopupRecommendation(result);
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

      {recommendation && (
        <div className={styles.recommendation}>
          <strong>{recommendation.text}</strong>
          <button
            type="button"
            onClick={() => onUseRecommendation(recommendation.amount)}
          >
            Use {recommendation.amountLabel}
          </button>
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
  const emptyText = result?.topups?.lookbackDays
    ? `No top-ups found in the last ${result.topups.lookbackDays} days.`
    : "No top-ups found.";

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
        <div className={styles.emptyState}>{emptyText}</div>
      )}
    </div>
  );
}

function SystemGuide() {
  return (
    <details className={styles.helpBox}>
      <summary>Supported Systems</summary>
      <div className={styles.helpContent}>
        <h2 className={styles.guideTitle}>Choose the right EVS system</h2>
        <p>
          <strong>CP2:</strong> PGPR, Houses at PGP except Valour House,
          Residential Colleges, and NUS College.
        </p>
        <p>
          <strong>CP2NUS:</strong> UTown Residence, RVRC, and Valour House.
        </p>
        <p>
          <strong>SUTD:</strong> SUTD EVS meters. Usage history is not available
          for SUTD yet.
        </p>
        <p>
          Balance checks, recent usage, and top-up history are available where
          the upstream EVS system provides them. Supported NUS top-up amounts
          are SGD 6.00 to SGD 50.00; supported SUTD top-up amounts are SGD 10.00
          to SGD 50.00.
        </p>
      </div>
    </details>
  );
}

export default function HomePage({
  initialGroupId = "",
  initialMode = "topup",
  landingKey = "",
}) {
  const [activeMode, setActiveMode] = useState(() =>
    normalizeInitialMode(initialMode),
  );
  const initialGroupIndex = HOSTEL_GROUPS.findIndex(
    (group) => group.id === initialGroupId,
  );
  const [groupIndex, setGroupIndex] = useState(
    initialGroupIndex >= 0 ? initialGroupIndex : null,
  );
  const [meterId, setMeterId] = useState("");
  const [meterLabel, setMeterLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState({});
  const [savedMeters, setSavedMeters] = useState([]);
  const [activeSavedId, setActiveSavedId] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [topupStatus] = useState(readRuntimeTopupStatus);

  useEffect(() => {
    const saved = readSavedState();
    setSavedMeters(saved.profiles);

    const active =
      saved.profiles.find((profile) => profile.id === saved.activeId) ||
      saved.profiles[0];
    if (!active) return;

    setActiveSavedId(active.id);
    setGroupIndex(active.groupIndex);
    setMeterId(active.meterId);
    setMeterLabel(active.label);
  }, []);

  function validateTopUp() {
    const e = {};
    const group = HOSTEL_GROUPS[groupIndex];
    const disabledMessage = getTopupDisabledMessage(group, topupStatus);
    if (!group) e.group = "Please select your hostel";
    else if (disabledMessage) e.group = disabledMessage;
    else if (!group.topupSupported) e.group = "Online top-up is not available.";
    if (!isValidMeterId(meterId)) e.meterId = "Must be exactly 8 digits";
    if (!isValidAmount(amount, group)) {
      e.amount = `Between ${amountRangeLabel(group)}`;
    }
    return e;
  }

  function validateLookup(value = meterId) {
    if (!isValidMeterId(value)) {
      setErrors({ meterId: "Must be exactly 8 digits" });
      return false;
    }
    setErrors({});
    return true;
  }

  function handleMeterChange(value) {
    setMeterId(value.replace(/\D/g, "").slice(0, 8));
    setActiveSavedId(null);
    if (errors.meterId) setErrors((p) => ({ ...p, meterId: undefined }));
  }

  function activateSavedMeter(profile) {
    setActiveSavedId(profile.id);
    setGroupIndex(profile.groupIndex);
    setMeterId(profile.meterId);
    setMeterLabel(profile.label);
    setErrors({});
    setLookupError("");
    persistSavedState(savedMeters, profile.id);
  }

  function handleSavedMeterSelect(profile) {
    activateSavedMeter(profile);
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
    const savedProfile = normalizeSavedProfile({
      groupIndex,
      meterId: cleanMeterId,
      label: meterLabel,
      savedAt: Date.now(),
    });
    const nextSavedMeters = upsertSavedProfile(savedMeters, savedProfile);
    setSavedMeters(nextSavedMeters);
    setActiveSavedId(savedProfile.id);
    setMeterLabel(savedProfile.label);
    persistSavedState(nextSavedMeters, savedProfile.id);

    const qs = new URLSearchParams({
      txtMtrId: cleanMeterId,
      txtAmount: amount.trim(),
    }).toString();

    window.location.href = `${group.basePath}/webapp?${qs}`;
  }

  async function runLookup(
    mode,
    lookupMeterId = meterId,
    lookupGroupIndex = groupIndex,
  ) {
    if (!validateLookup(lookupMeterId)) return;

    const group = HOSTEL_GROUPS[lookupGroupIndex];
    if (mode === "usage" && group?.usageSupported === false) {
      setErrors({});
      setLookupResult(null);
      setLookupError("Usage history is not available for SUTD yet.");
      return;
    }

    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);

    try {
      const qs = new URLSearchParams({
        meterId: lookupMeterId.trim(),
        mode,
      });
      if (group?.id === "sutd") qs.set("hostel", group.id);
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

  async function handleLookupSubmit(e) {
    e.preventDefault();
    await runLookup(activeMode, meterId);
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

  function handleUseRecommendation(recommendedAmount) {
    setAmount(String(recommendedAmount));
    setErrors((p) => ({ ...p, amount: undefined }));
    setActiveMode("topup");
  }

  const isLookupMode = ["balance", "usage", "topups"].includes(activeMode);
  const selectedGroup = HOSTEL_GROUPS[groupIndex] || null;
  const selectedTopupDisabledMessage = getTopupDisabledMessage(
    selectedGroup,
    topupStatus,
  );
  const landingCopy = getLandingCopy(landingKey || initialGroupId);

  return (
    <Card align="left" className={styles.homeCard}>
      <Logo>⚡</Logo>
      <h1 className={styles.title}>{landingCopy.title}</h1>
      <p className={styles.sub}>{landingCopy.subtitle}</p>

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

      {savedMeters.length > 0 && (
        <div className={styles.savedList} aria-label="Saved meters">
          {savedMeters.map((profile) => (
            <div
              key={profile.id}
              className={[
                styles.savedMeter,
                activeSavedId === profile.id ? styles.savedMeterActive : "",
              ].join(" ")}
            >
              <button
                type="button"
                className={styles.savedMeterSelect}
                aria-pressed={activeSavedId === profile.id}
                onClick={() => handleSavedMeterSelect(profile)}
              >
                <strong>{profile.label}</strong>
                <span>
                  {profile.meterId} · {HOSTEL_GROUPS[profile.groupIndex].label}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      <details className={styles.helpBox}>
        <summary>Help</summary>
        <div className={styles.helpContent}>
          <p>
            Supported NUS hostels: PGPR, Houses at PGP except Valour House,
            Residential Colleges, NUS College, UTown Residence, RVRC, and Valour
            House. SUTD meter balance, top-up history, and online top-up are
            also supported.
          </p>
          <p>
            Accepted NUS top-up amount: SGD 6.00 to SGD 50.00. Accepted SUTD
            top-up amount: SGD 10.00 to SGD 50.00.
          </p>
        </div>
      </details>

      <SystemGuide />

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
                    setActiveSavedId(null);
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
            {selectedTopupDisabledMessage && !errors.group && (
              <div className={styles.errorBox}>
                {selectedTopupDisabledMessage}
              </div>
            )}
          </div>

          <MeterField
            meterId={meterId}
            error={errors.meterId}
            onChange={handleMeterChange}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="meterLabel">
              Label
            </label>
            <input
              id="meterLabel"
              className={styles.input}
              type="text"
              maxLength={24}
              placeholder="Room, Friend, Old room"
              value={meterLabel}
              onChange={(e) => setMeterLabel(e.target.value)}
            />
          </div>

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
                min={HOSTEL_GROUPS[groupIndex]?.minAmount ?? MIN_TOPUP_AMOUNT}
                max={HOSTEL_GROUPS[groupIndex]?.maxAmount ?? MAX_TOPUP_AMOUNT}
                step="0.01"
                placeholder={
                  HOSTEL_GROUPS[groupIndex]
                    ? `${HOSTEL_GROUPS[groupIndex].minAmount.toFixed(2)} - ${HOSTEL_GROUPS[groupIndex].maxAmount.toFixed(2)}`
                    : "6.00 - 50.00"
                }
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
            <button
              type="submit"
              className={styles.btn}
              disabled={Boolean(selectedTopupDisabledMessage)}
            >
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
          <div className={styles.field}>
            <label className={styles.label}>Hostel / system</label>
            <div className={styles.groupList}>
              {HOSTEL_GROUPS.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  className={[
                    styles.groupBtn,
                    groupIndex === i ? styles.groupBtnActive : "",
                  ].join(" ")}
                  onClick={() => {
                    setGroupIndex(i);
                    setActiveSavedId(null);
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

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
              {activeMode === "usage" && (
                <UsageResult
                  result={lookupResult}
                  onUseRecommendation={handleUseRecommendation}
                />
              )}
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
