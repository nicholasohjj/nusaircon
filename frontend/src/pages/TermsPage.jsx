import { useEffect } from "react";
import { Card, Logo } from "../components/Card";
import styles from "./TermsPage.module.css";

function useTelegram() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);
}

function Section({ id, title, children }) {
  return (
    <section className={styles.section} id={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Para({ children }) {
  return <p className={styles.para}>{children}</p>;
}

function SubHeading({ children }) {
  return <p className={styles.subheading}>{children}</p>;
}

function Ul({ items }) {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  useTelegram();

  return (
    <Card align="left">
      <Logo>⚡</Logo>

      <div className={styles.header}>
        <h1 className={styles.title}>Terms of Use</h1>
        <p className={styles.meta}>
          EVS Meter Tools · Last updated: August 2026
        </p>
        <Para>
          Please read these Terms carefully before using EVS Meter Tools ("the
          Service"). By using the Service, you agree to be bound by these Terms.
          If you do not agree, do not use the Service.
        </Para>
      </div>

      <Section id="s1" title="1. Service overview">
        <Para>
          The Service is an unofficial, independently developed tool that
          enables users of supported EVS electricity meters to check meter
          balance, view supported top-up history, and, where enabled, top up
          meters via credit card through Telegram or the standalone web app. It
          is not affiliated with, endorsed by, or operated by NUS, SUTD, EVS,
          eNETS, or any payment network.
        </Para>
      </Section>

      <Section id="s2" title="2. Eligibility">
        <Para>You may use the Service only if you:</Para>
        <Ul
          items={[
            "Are a current resident or authorised user for a supported EVS meter system, including supported NUS hostel meters or supported SUTD meters;",
            "Hold a valid EVS electricity meter registered to your unit; and",
            "Are authorised to make payments for that meter.",
          ]}
        />
      </Section>

      <Section id="s3" title="3. Payment terms">
        <Para>
          <strong>Where online top-up is enabled, top-up amounts</strong> are
          subject to a minimum of SGD $6.00 and a maximum of SGD $50.00 per
          transaction.
        </Para>
        <Para>
          <strong>Card payments</strong> are processed through eNETS. By
          initiating a payment, you authorise the charge to your credit card and
          agree to eNETS' payment terms and conditions.
        </Para>
        <Para>
          <strong>No refunds</strong> are guaranteed through this Service. Once
          a top-up is successfully submitted to the EVS system, it cannot be
          reversed through this service. For disputes, contact EVS or your card
          issuer directly.
        </Para>
        <SubHeading>Failed transactions.</SubHeading>
        <Para>
          If a payment is declined or the process fails partway through, a
          charge may not be applied. However, some card issuers may place a
          temporary pre-authorisation hold even when a transaction does not
          complete. In the event of any technical failure mid-flow, verify the
          outcome with your card issuer and EVS before retrying.
        </Para>
        <SubHeading>Session expiry during payment.</SubHeading>
        <Para>
          Payment and result pages use time-limited encrypted tokens. A pending
          payment token expires after approximately 10 minutes, and a completed
          result token expires after approximately 24 hours. If a token expires,
          a result page becomes inaccessible, a receipt link may be unavailable,
          or a third-party EVS/eNETS session may no longer be usable. If you do
          not receive a confirmation through the Service or your card issuer,
          verify the outcome directly with your card issuer and EVS before
          retrying, to avoid being charged twice.
        </Para>
        <SubHeading>Top-up not reflected on meter.</SubHeading>
        <Para>
          If your payment is confirmed by your card issuer but the top-up does
          not appear on your meter, the Service operator has no ability to
          investigate or resolve this. You must contact EVS directly with your
          transaction reference number. Do not retry the payment until the
          original transaction has been clarified, to avoid being charged twice.
        </Para>
        <SubHeading>
          Electricity or air conditioning not functioning after top-up.
        </SubHeading>
        <Para>
          The Service is solely a payment interface. It has no control over
          meter activation, electricity delivery, air conditioning operation, or
          any hostel infrastructure. If your electricity or air conditioning
          does not function after a successful top-up, contact your hostel
          management office or EVS directly. This is entirely outside the scope
          of this service and the Service operator bears no responsibility.
        </Para>
      </Section>

      <Section id="s4" title="4. Card security">
        <Para>
          Your card details are <strong>RSA-encrypted in your browser</strong>{" "}
          before transmission. The Service's server never receives or stores
          your plaintext card number or CVV. Despite this, you use this service
          at your own risk. We make no warranties about the security of
          third-party systems (eNETS, EVS) involved in processing your payment.
        </Para>
      </Section>

      <Section id="s5" title="5. Meter identity and system routing">
        <Para>
          You are responsible for entering the correct 8-digit meter ID. Topping
          up the wrong meter is your sole responsibility. The Service includes a
          cross-system guard for cp2nus users that rejects meters belonging to
          the cp2 system before payment is initiated, but this check is not
          infallible. If you are unsure which system your meter belongs to,
          verify with your institution, residence operator, or EVS.
        </Para>
        <SubHeading>Meter ID not found.</SubHeading>
        <Para>
          If your meter ID cannot be located in the EVS system, the Service will
          not be able to proceed with a top-up. This may occur for newly
          assigned units, recently transferred residents, or due to delays in
          the EVS system. Verify your meter ID with your institution, residence
          operator, or EVS before retrying. The Service operator cannot manually
          look up, register, or resolve meter ID issues on your behalf.
        </Para>
      </Section>

      <Section id="s6" title="6. Session and data handling">
        <Ul
          items={[
            "When you use the Bot, your Telegram chat identifier, meter ID(s), selected EVS system, meter label, and saved/last-used timestamps are stored in a service-operated database so you do not need to re-enter them on future top-ups or lookups. You can remove saved meter records with the /forget command. This does not remove information already held in operational, security, or analytics logs, where retention may be necessary for those purposes.",
            "Bot sessions (conversation state, current top-up stage) are held in memory only and expire after 15 minutes of inactivity. They are not written to disk and are lost on service restart.",
            "Pending payment tokens are encrypted and time-limited. They may contain the meter ID, top-up amount, address, balance, Telegram chat identifier if the flow was started from Telegram, and eNETS gateway fields required to complete the payment. They expire after approximately 10 minutes.",
            "Completed result tokens are encrypted and time-limited. They may contain the meter ID, top-up amount, address, balance, transaction outcome, transaction reference, and Telegram chat identifier if available. They expire after approximately 24 hours.",
            "Receipt PDFs, when available for cp2nus payments, may be cached temporarily and may become unavailable after expiry or service restart.",
            "To support feedback replies, Telegram message-routing information is held in memory for up to 7 days after a Bot feedback submission. This consists of Telegram message and chat identifiers.",
            "Feedback content, ratings, and any contact details you provide may be recorded in service logs, sent to the Service operator through Telegram, and processed by our analytics and hosting providers to receive, respond to, and improve the Service. Do not include card details or other sensitive information in feedback.",
            "Basic analytics and request logs are captured to maintain service quality, troubleshoot errors, and limit abuse. These may include request path, response status, IP address, user agent, Telegram chat identifier, meter ID, top-up amount, transaction outcome, feedback-related event data, and error details, but never your plaintext card details. Sensitive URL fields such as payment tokens are redacted from structured request logs.",
            "We disclose information only as needed to operate the Service: to Telegram for Bot communications; eNETS and EVS or relevant institutional systems to process lookups and payments; and hosting, logging, and analytics providers. These providers may process information outside Singapore.",
            "By submitting feedback through the Bot or website, you consent to it being forwarded to the Service operator. If you provide contact details, they may be used to respond to your feedback.",
          ]}
        />
      </Section>

      <Section id="s7" title="7. Operator communication">
        <Para>
          When you submit Bot feedback, the Service operator may reply to you
          directly through the Bot. These replies are sent via Telegram and will
          appear as messages from the Bot. You may also reply to those messages
          and your reply will be forwarded to the operator. For website feedback,
          the Service operator may use the contact details you provide to respond.
          These exchanges are limited to feedback and support matters.
        </Para>
      </Section>

      <Section id="s8" title="8. Availability and accuracy">
        <Para>
          The Service depends on third-party systems (EVS WebPOS, EVS JSON API,
          eNETS) that may change or become unavailable without notice. We do
          not guarantee uninterrupted service, accurate balance data, or
          successful payment processing at any given time.
        </Para>
        <Para>
          NUS balance and usage figures are fetched from the ORE API. SUTD
          balance, top-up history, and top-up setup are fetched from the SUTD
          EVS WebPOS portal. These values may not reflect real-time meter
          readings.
        </Para>
        <Para>
          The Service may apply rate limits to protect payment and lookup
          endpoints. If you exceed those limits, you may need to wait before
          retrying.
        </Para>
      </Section>

      <Section id="s9" title="9. Prohibited use">
        <Para>You must not:</Para>
        <Ul
          items={[
            "Use the Service to top up a meter you are not authorised to pay for;",
            "Attempt to reverse-engineer, scrape, abuse, or disrupt the Service or any connected system;",
            "Submit false, fraudulent, or stolen payment credentials; or",
            "Circumvent any security or validation measure in the Service.",
          ]}
        />
      </Section>

      <Section id="s10" title="10. Disclaimer of warranties">
        <Para>
          The Service is provided <strong>"as is"</strong> without warranties of
          any kind, express or implied. We do not warrant that the Service will
          be error-free, that payments will succeed, or that meter balances
          displayed will be accurate.
        </Para>
      </Section>

      <Section id="s11" title="11. Limitation of liability">
        <Para>
          To the fullest extent permitted by law, the Service operator shall not
          be liable for any direct, indirect, incidental, or consequential loss
          arising from your use of the Service, including but not limited to
          failed or duplicate payments, incorrect meter top-ups, or third-party
          system errors.
        </Para>
      </Section>

      <Section id="s12" title="12. Changes to these terms">
        <Para>
          These Terms may be updated at any time. Continued use of the Service
          after changes constitutes acceptance of the revised Terms.
        </Para>
      </Section>

      <Section id="s13" title="13. Contact">
        <Para>
          For issues, disputes, or feedback, use the{" "}
          <code className={styles.code}>/feedback</code> command in the Bot or
          the Feedback section of the web app. For a privacy, access, correction,
          or deletion request, use either channel, state that the request concerns
          privacy, and provide enough information for us to verify and locate your
          records. We may need to verify your identity before acting on a request.
        </Para>
      </Section>
    </Card>
  );
}
