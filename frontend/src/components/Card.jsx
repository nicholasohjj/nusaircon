import styles from "./Card.module.css";

export function Card({ children, align = "center", className = "" }) {
  return (
    <div
      className={[styles.card, className].filter(Boolean).join(" ")}
      style={{ textAlign: align }}
    >
      {children}
    </div>
  );
}

export function DetailRow({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

export function Logo({ children }) {
  return <div className={styles.logo}>{children}</div>;
}
