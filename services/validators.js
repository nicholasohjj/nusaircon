function isValidMeterId(txtMtrId) {
  return /^\d{8}$/.test(String(txtMtrId || "").trim());
}

function parsePaymentAmount(txtAmount) {
  if (typeof txtAmount === "number") {
    return Number.isFinite(txtAmount) ? txtAmount : null;
  }

  const value = String(txtAmount ?? "").trim();
  if (!value) return null;

  const match = /^(?:S\$\s*|\$\s*)?(\d+(?:\.\d{1,2})?)$/i.exec(value);
  if (!match) return null;

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

function isValidAmount(txtAmount) {
  const amount = parsePaymentAmount(txtAmount);
  return amount !== null && amount >= 6 && amount <= 50;
}

function validationError({ txtMtrId, txtAmount }) {
  if (!txtMtrId && !txtAmount) {
    return "Please enter your meter ID and top-up amount.";
  }

  if (!txtMtrId) {
    return "Please enter your meter ID.";
  }

  if (!txtAmount) {
    return "Please enter a top-up amount.";
  }

  if (!isValidMeterId(txtMtrId)) {
    return "Invalid meter ID. Meter ID must be exactly 8 digits.";
  }

  if (!isValidAmount(txtAmount)) {
    return "Invalid amount. Please enter an amount between $6.00 and $50.00.";
  }

  return null;
}

module.exports = {
  isValidAmount,
  isValidMeterId,
  parsePaymentAmount,
  validationError,
};
