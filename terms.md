# Terms of Use

**EVS Meter Tools**
Last updated: June 2026

Please read these Terms of Use ("Terms") carefully before using EVS Meter Tools ("the Service"). By using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.

---

## 1. Service Overview

The Service is an unofficial, independently developed tool that enables users of supported EVS electricity meters to check meter balance, view supported top-up history, and, where enabled, top up meters via credit card through Telegram or the standalone web app. It is not affiliated with, endorsed by, or operated by NUS, SUTD, EVS, eNETS, or any payment network.

---

## 2. Eligibility

You may use the Service only if you:

- Are a current resident or authorised user for a supported EVS meter system, including supported NUS hostel meters or supported SUTD meters;
- Hold a valid EVS electricity meter registered to your unit; and
- Are authorised to make payments for that meter.

---

## 3. Payment Terms

**Where online top-up is enabled, top-up amounts** are subject to a minimum of SGD $6.00 and a maximum of SGD $50.00 per transaction.

**Card payments** are processed through eNETS. By initiating a payment, you authorise the charge to your credit card and agree to eNETS' payment terms and conditions.

**No refunds** are guaranteed through this Service. Once a top-up is successfully submitted to the EVS system, it cannot be reversed through this service. For disputes, contact EVS or your card issuer directly.

**Failed transactions.** If a payment is declined or the process fails partway through, a charge may not be applied. However, some card issuers may place a temporary pre-authorisation hold even when a transaction does not complete. In the event of any technical failure mid-flow, verify the outcome with your card issuer and EVS before retrying.

**Session expiry during payment.** Payment and result pages use time-limited encrypted tokens. A pending payment token expires after approximately 10 minutes, and a completed result token expires after approximately 24 hours. If a token expires, a result page becomes inaccessible, a receipt link may be unavailable, or a third-party EVS/eNETS session may no longer be usable. If you do not receive a confirmation through the Service or your card issuer, verify the outcome directly with your card issuer and EVS before retrying, to avoid being charged twice.

**Top-up not reflected on meter.** If your payment is confirmed by your card issuer but the top-up does not appear on your meter, the Service operator has no ability to investigate or resolve this. You must contact EVS directly with your transaction reference number. Do not retry the payment until the original transaction has been clarified, to avoid being charged twice.

**Electricity or air conditioning not functioning after top-up.** The Service is solely a payment interface. It has no control over meter activation, electricity delivery, air conditioning operation, or any hostel infrastructure. If your electricity or air conditioning does not function after a successful top-up, contact your hostel management office or EVS directly. This is entirely outside the scope of this service and the Service operator bears no responsibility.

---

## 4. Card Security

Your card details are **RSA-encrypted in your browser** before transmission. The Service's server never receives or stores your plaintext card number or CVV. Despite this, you use this service at your own risk. We make no warranties about the security of third-party systems (eNETS, EVS) involved in processing your payment.

---

## 5. Meter Identity and System Routing

You are responsible for entering the correct 8-digit meter ID. Topping up the wrong meter is your sole responsibility. The Service includes a cross-system guard for cp2nus users that rejects meters belonging to the cp2 system before payment is initiated, but this check is not infallible. If you are unsure which system your meter belongs to, verify with your institution, residence operator, or EVS.

**Meter ID not found.** If your meter ID cannot be located in the EVS system, the Service will not be able to proceed with a top-up. This may occur for newly assigned units, recently transferred residents, or due to delays in the EVS system. Verify your meter ID with your institution, residence operator, or EVS before retrying. The Service operator cannot manually look up, register, or resolve meter ID issues on your behalf.

---

## 6. Session and Data Handling

- Your **meter ID and selected EVS system** are saved to a local database so you do not need to re-enter them on future top-ups or lookups. You can delete this at any time with the `/forget` command.
- **Bot sessions** (conversation state, current top-up stage) are held in memory only and expire after 15 minutes of inactivity. They are not written to disk and are lost on service restart.
- **Pending payment tokens** are encrypted and time-limited. They may contain the meter ID, top-up amount, address, balance, Telegram chat identifier if the flow was started from Telegram, and eNETS gateway fields required to complete the payment. They expire after approximately 10 minutes.
- **Completed result tokens** are encrypted and time-limited. They may contain the meter ID, top-up amount, address, balance, transaction outcome, transaction reference, and Telegram chat identifier if available. They expire after approximately 24 hours.
- **Receipt PDFs**, when available for cp2nus payments, may be cached temporarily and may become unavailable after expiry or service restart.
- To support feedback replies, message routing information is held in memory for up to **7 days** after a feedback submission. This consists only of Telegram message and chat identifiers; no message content is retained beyond what Telegram itself stores.
- Basic analytics and request logs are captured to maintain service quality, troubleshoot errors, and limit abuse. These may include request path, response status, IP address, user agent, meter ID, top-up amount, transaction outcome, and error details, but never your plaintext card details. Sensitive URL fields such as payment tokens are redacted from structured request logs.
- By submitting feedback via `/feedback`, you consent to your message being forwarded to the Service operator and to receiving a reply from the Service operator through the Bot.

---

## 7. Operator Communication

When you submit feedback, the Service operator may reply to you directly through the Bot. These replies are sent via Telegram and will appear as messages from the Bot. You may also reply to those messages and your reply will be forwarded to the operator. This two-way exchange is limited to feedback threads and is not used for any other purpose.

---

## 8. Availability and Accuracy

The Service depends on third-party systems (EVS WebPOS, EVS JSON API, eNETS) that may change or become unavailable without notice. We do not guarantee uninterrupted service, accurate balance data, or successful payment processing at any given time.

The Service may apply rate limits to protect payment and lookup endpoints. If you exceed those limits, you may need to wait before retrying.

NUS balance and usage figures are fetched from the ORE API. SUTD balance, top-up history, and top-up setup are fetched from the SUTD EVS WebPOS portal. These values may not reflect real-time meter readings.

---

## 9. Prohibited Use

You must not:

- Use the Service to top up a meter you are not authorised to pay for;
- Attempt to reverse-engineer, scrape, abuse, or disrupt the Service or any connected system;
- Submit false, fraudulent, or stolen payment credentials; or
- Circumvent any security or validation measure in the Service.

---

## 10. Disclaimer of Warranties

The Service is provided **"as is"** without warranties of any kind, express or implied. We do not warrant that the Service will be error-free, that payments will succeed, or that meter balances displayed will be accurate.

---

## 11. Limitation of Liability

To the fullest extent permitted by law, the Service operator shall not be liable for any direct, indirect, incidental, or consequential loss arising from your use of the Service, including but not limited to failed or duplicate payments, incorrect meter top-ups, or third-party system errors.

---

## 12. Changes to These Terms

These Terms may be updated at any time. Continued use of the Service after changes constitutes acceptance of the revised Terms.

---

## 13. Contact

For issues, disputes, or feedback, use the `/feedback` command within the Bot.
