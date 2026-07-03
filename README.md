# EVS Meter Tools

A Telegram bot and web app for supported EVS electricity meters. Supported NUS and SUTD meters can be topped up by credit card, and supported lookup flows show balance, usage, and top-up history where available.

## Supported systems

| Hostel group                                          | EVS system          |
| ----------------------------------------------------- | ------------------- |
| PGPR, Houses @ PGP except Valour House, Residential Colleges, NUS College | `cp2.evs.com.sg`    |
| UTown Residences, RVRC, Valour House                                     | `cp2nus.evs.com.sg` |
| SUTD                                                  | `SUTDMain` / `EVSSUTDWebPOS` |

## Features

- Check meter balance, 7-day usage history, and recent top-ups from within Telegram
- Top up supported NUS electricity meters via credit card (SGD $6-$50)
- Top up supported SUTD electricity meters via credit card (SGD $10-$50)
- RSA-encrypted card entry — card details never leave the browser in plaintext
- Works as a Telegram Mini App and as a standalone website
- Cross-system guard: cp2nus bootstrap rejects meters that belong to the cp2 system before initiating payment
- Cross-system guard: cp2 bootstrap rejects meters that appear to belong to the cp2nus system before initiating payment
- SUTD balance, top-up history, and top-up support
- Analytics tracking and error capture throughout the flow

## Architecture

```
Telegram Bot (telegraf)          Website (React, /app/)
    │                                │
    ├── /topup                       └── HomePage
    ├── /balance                          └── hostel selection
    ├── /usage                                + meter ID + amount
    └── /topups
          │ webhook in production/Railway,       │
          │ polling in development               │
          ▼                                       ▼
    Express (server.js)  ←────────────────────────────
          │
          ├── POST /telegram/webhook/* — Telegram webhook receivers
          ├── GET  /webapp              — fetches meter summary, redirects to React
          ├── GET  /webapp/bootstrap    — runs full payment init, returns token
          ├── GET  /webapp/session      — returns session data as JSON for React
          ├── GET  /webapp/pay          — redirects to React card entry page
          ├── POST /webapp/enets_pay    — proxies encrypted card data to eNETS
          ├── POST /webapp/notify       — fallback Telegram payment notification
          └── GET  /webapp/result       — redirects to React result page

    React Frontend (/app/)
          ├── /                 — HomePage (hostel + meter ID + amount)
          ├── /cp2              — HomePage preselected for PGPR / PGP Houses / RC / NUS College
          ├── /balance          — HomePage opened in balance-check mode
          ├── /loading          — LoadingPage (calls /webapp/bootstrap)
          ├── /pay              — CardPaymentPage (RSA encryption + submit)
          ├── /result           — ResultPage (outcome from server session)
          ├── /cp2nus           — HomePage preselected for UTown Residences / RVRC / Valour House
          ├── /cp2nus/loading   — cp2nus variant
          ├── /cp2nus/pay       — cp2nus variant
          ├── /cp2nus/result    — cp2nus variant
          ├── /sutd/loading     — SUTD variant
          ├── /sutd/pay         — SUTD variant
          └── /sutd/result      — SUTD variant
```

## Payment flows

### CP2 — PGPR / Houses @ PGP except Valour House / Residential Colleges / NUS College

Scrapes the EVS WebPOS portal to create a transaction, then proxies through eNETS.

1. **`/webapp`** — fetches meter address and balance from ORE, redirects to React loading page with address/balance in query params
2. **Bootstrap** (`/webapp/bootstrap`) — runs `runPurchaseFlow` and `getMeterSummary` in parallel:
   - `GET /EVSWebPOS/` → login → `POST /loginServlet` (meter validation)
   - `POST /selectOfferServlet` (amount selection)
   - `GET /paymentServlet` → extract `merchant_txn_ref`
   - `POST creditpayment.jsp` → extract eNETS `message`
   - `POST /enets2/PaymentListener.do` → extract RSA public key (`n`, `e`), `netsMid`, `netsTxnRef`
   - Creates a payment session (10-min TTL), redirects to React card page
3. **Card page** (`/app/pay`) — React component; fetches session via `/webapp/session`; encrypts `cardNo + cvv` with eNETS RSA scripts client-side
4. **Payment proxy** (`/webapp/enets_pay`):
   - `POST https://www.enets.sg/GW2/uCredit/pay`
   - **Preferred path:** extracts EVS callback form → `POST /EVSWebPOS/transSumServlet` → `parseEvsTransactionSummary`
   - **Fallback:** `parseEnetsResult` scrapes the eNETS receipt HTML directly
   - Writes outcome (`status`, `merchantTxnRef`, `reason`) back to the server-side session
5. **Result page** (`/app/result`) — React component; reads outcome from server session via `/webapp/session`

### CP2NUS — UTown Residences / RVRC / Valour House

Uses the EVS JSON API and the eNETS Payment Page (enetspp) host directly.

1. **`/webapp`** — same as cp2; fetches meter info, redirects to `/app/cp2nus/loading`
2. **Bootstrap** (`/cp2nus/webapp/bootstrap`) — `runBootstrap` runs sequentially:
   - **Meter system check** — `isCp2Meter()` guard: rejects cp2 meters with a `WRONG_SYSTEM` error; on network failure the check is skipped and flow proceeds
   - **`init_pay`** — `POST /enets/init_pay` → `{ txn_identifier, req, sign }`
   - **`meter_info`** — `getMeterSummary` → `buildPayDisplayAddress`
   - **`enetspp_pay`** — `buildEnetsPayUrl` → `GET enetspp/pay?p=…` → extract `txnReq`, `keyId`, `hmac`
   - **`TxnReqListener`** — `POST /GW2/TxnReqListener` → RSA key, `netsTxnRef`, `netsMid`, `paymtNetsMid`, `txnRand`, `keyId`, `hmac`
3. **Card page** (`/app/cp2nus/pay`) — same RSA encryption; `paymtNetsMid` (acquiring MID) used in `panSubmitForm`, not top-level `netsMid`
4. **Payment proxy** (`/cp2nus/webapp/enets_pay`):
   - `GET /GW2/pluginpages/env.jsp` → seed `JSESSIONID`
   - `POST /GW2/credit/init;jsessionid=…`
   - `POST /GW2/credit/panSubmitForm`
   - **Preferred path:** `netsTxnStatus` in response → `preParsed` result (no b2s call)
   - **Fallback:** `POST /enets/b2s` → 303 redirect → `parsePayResult` base64-decodes params
5. **Result page** (`/app/cp2nus/result`) — reads outcome from server session

### SUTD

Uses the SUTD EVS WebPOS pages and the SUTD credit payment bridge.

1. **`/sutd/webapp`** — fetches SUTD meter credit, redirects to `/app/sutd/loading`
2. **Bootstrap** (`/sutd/webapp/bootstrap`) — runs the SUTD WebPOS flow:
   - `POST /EVSSUTDWebPOS/loginServlet` with the meter ID
   - `POST /EVSSUTDWebPOS/selectOfferServlet` with the selected amount
   - `GET /EVSSUTDWebPOS/paymentServlet` → extract `merchant_txn_ref`
   - `POST http://120.50.44.233/payment_sutd_credit/creditpayment.jsp`
   - `POST /enets2/PaymentListener.do` → extract RSA public key, `netsMid`, `netsTxnRef`
3. **Card page** (`/app/sutd/pay`) — same RSA-encrypted card entry as NUS flows
4. **Payment proxy** (`/sutd/webapp/enets_pay`) — posts encrypted card data to eNETS, then posts the callback to `/EVSSUTDWebPOS/transSumServlet`
5. **Result page** (`/app/sutd/result`) — reads outcome from server session

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A publicly accessible HTTPS server (required for Telegram WebApp buttons)

### Installation

```bash
# Install backend dependencies
npm install

# Install and build the frontend
npm run build:frontend
```

### Environment variables

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here      # legacy single-bot token
NUS_TELEGRAM_BOT_TOKEN=your_nus_bot_token   # optional, for concurrent nusairconbot
SUTD_TELEGRAM_BOT_TOKEN=your_sutd_bot_token # optional, for concurrent sutdairconbot
PAYMENT_SESSION_SECRET=replace_with_openssl_rand_hex_32 # stable secret for signed payment/result tokens
SERVER_URL=https://your-public-server.example.com
OWNER_CHAT_ID=your_telegram_chat_id   # receives feedback notifications
MAINTENANCE_MODE=false                # set to "true" to put the app and bot in global maintenance mode
MAINTENANCE_MESSAGE=                  # optional custom global maintenance message
OWNER_STATUS_TIMEOUT_MS=4000          # optional timeout for owner /status EVS/eNETS checks
TOPUP_DISABLED=false                  # set to "true" to show maintenance message
DB_DIR=.                              # local SQLite dir; use /data on Railway with a mounted volume
TELEGRAM_BOT_MODE=                    # production/Railway defaults to webhook; dev defaults to polling
TELEGRAM_BOT_AUDIENCE=nus             # legacy single-bot mode: "nus" or "sutd"
GOOGLE_SITE_VERIFICATION_FILE=        # optional Search Console HTML file name, e.g. googleabc123.html
GOOGLE_SITE_VERIFICATION_CONTENT=     # optional exact file body if Google provides non-default content
```

`SERVER_URL` must be HTTPS for the Telegram WebApp payment button to work. If it is HTTP, the bot falls back to a plain browser link instead. On Railway, set it to `https://${{RAILWAY_PUBLIC_DOMAIN}}` or leave it unset and the app will derive it from `RAILWAY_PUBLIC_DOMAIN`.

`PAYMENT_SESSION_SECRET` should be a stable random value, for example from `openssl rand -hex 32`. If it is omitted, the app falls back to the configured bot token, which still survives Railway sleeps as long as the bot token does not change.

For Google Search Console URL-prefix verification, use the HTML file method and set `GOOGLE_SITE_VERIFICATION_FILE` to the downloaded file name. The default response body is `google-site-verification: <file name>`. If Google's downloaded file contains different text, set `GOOGLE_SITE_VERIFICATION_CONTENT` to the exact file body.

In production, or when `RAILWAY_PUBLIC_DOMAIN` is present, each configured bot uses a Telegram webhook by default so Railway Serverless can sleep and wake from inbound Telegram requests. Set `TELEGRAM_BOT_MODE=polling` only for an always-on deployment. Optional webhook variables are `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_DROP_PENDING_UPDATES` for single-bot mode. For concurrent bots, use `NUS_TELEGRAM_WEBHOOK_PATH`, `NUS_TELEGRAM_WEBHOOK_SECRET`, `SUTD_TELEGRAM_WEBHOOK_PATH`, and `SUTD_TELEGRAM_WEBHOOK_SECRET` only if you need custom paths; otherwise unique paths are generated automatically.

For concurrent Telegram bots in one deployment, set both `NUS_TELEGRAM_BOT_TOKEN` and `SUTD_TELEGRAM_BOT_TOKEN`. The same service starts both `nusairconbot` and `sutdairconbot`, with separate command menus, webhook paths, in-memory sessions, and payment notifications. Single-bot deployments can still use `TELEGRAM_BOT_TOKEN` plus `TELEGRAM_BOT_AUDIENCE`.

### Running

```bash
# Development (two terminals)
npm run dev            # Express backend on :3000
npm run dev:frontend   # Vite dev server on :5173

# Production
npm run build:frontend
npm start
```

The frontend is served at `/app/` by Express in production. In development, Vite proxies `/webapp`, `/cp2nus`, and `/sutd` to the backend.

For local development, keep `DB_DIR=.` or omit it. On Railway, set `DB_DIR=/data` only after attaching a volume mounted at `/data`.

### Railway Serverless

The repo includes `railway.json` with the production build, start command, and `/health` check. Railway Serverless itself is enabled in the dashboard:

1. Add a public domain for the service.
2. Set either `TELEGRAM_BOT_TOKEN` for one bot, or `NUS_TELEGRAM_BOT_TOKEN` and `SUTD_TELEGRAM_BOT_TOKEN` for concurrent bots. Also set `PAYMENT_SESSION_SECRET`, `SERVER_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, and any optional variables such as `OWNER_CHAT_ID`.
3. Attach a volume mounted at `/data` and set `DB_DIR=/data` so saved users survive restarts.
4. Go to service settings > Deploy > Serverless and enable Serverless.
5. Deploy. Startup will register the Telegram webhook automatically.

Cold starts can make the first Telegram or web request slower, and Railway may return a first-request `502` while waking the service. Bot sessions and owner reply threads are in-memory and reset by restarts or sleeps; payment/result tokens are sealed with `PAYMENT_SESSION_SECRET` and can still be read after a restart until their TTL expires. Saved meter IDs remain in SQLite.

### Testing

```bash
# Backend tests
npm test

# Frontend tests
cd frontend && npm test

# Lint backend and frontend
npm run lint
```

## Bot commands

| Command     | Description                       |
| ----------- | --------------------------------- |
| `/start`    | Show the main menu                |
| `/topup`    | Start an electricity top-up       |
| `/balance`  | Check meter balance               |
| `/usage`    | Show last 7 days of usage         |
| `/topups`   | Show recent top-ups               |
| `/feedback` | Share feedback or report an issue |
| `/cancel`   | Cancel the current flow           |
| `/help`     | Show help and hostel information  |
| `/status`   | Owner-only live service health    |
| `/stats`    | Owner-only runtime snapshot       |

## Bot session flow

Sessions are stored in-memory with a **15-minute TTL**. All messages for a given chat are serialised through a per-chat lock to prevent race conditions. On serverless deployments, sessions reset when Railway stops and later restarts the service. The top-up flow stages are:

```
idle
  → awaiting_hostel            (cp2 / cp2nus inline keyboard)
  → awaiting_meter_id          (8-digit ID; prefetches balance + 7-day usage)
  → awaiting_amount            ($6–$50 SGD)
  → awaiting_payment           (WebApp Pay button; re-prompts on text)
  → idle                       (reset after WebApp closes)

  → awaiting_meter_id_balance  (/balance with no saved meter)
  → awaiting_meter_id_usage    (/usage with no saved meter)
  → awaiting_meter_id_topups   (/topups with no saved meter)

  → awaiting_feedback_rating   (/feedback — star rating keyboard)
  → awaiting_feedback_text     (free-text or ⏭ Skip)
  → idle
```

`/balance`, `/usage`, and `/topups` use single-step stages that return to idle after one response.

## Payment Session

Payment sessions (created by `/webapp/bootstrap`) are sealed encrypted tokens with a **10-minute TTL**, separate from bot sessions. The token holds the meter ID, amount, address, balance, and eNETS gateway fields needed for payment. This avoids losing an active payment session when Railway Free wakes the service on a new process.

Once `/webapp/enets_pay` has a final outcome, the server sends the Telegram payment notification immediately and returns a sealed result token with a **24-hour TTL**. Payment and result tokens carry an internal `tokenKind`; payment routes reject result tokens, and result routes reject payment tokens. The React result page reads outcome data from `GET /webapp/session?token=`; query params are never trusted for payment results. CP2NUS receipt PDFs are still held in a volatile in-memory cache, so the result page only shows the receipt link when that cache entry is available.

## User store

Saved meter IDs and hostels are persisted in a SQLite database (`evs_users.db`) using `better-sqlite3`. The database is written to `DB_DIR` (Railway Volume at `/data` if present, otherwise the project root). Unlike bot sessions and payment sessions, the user store survives restarts.

## Owner reply threading

When a user submits feedback, the bot forwards a notification to `OWNER_CHAT_ID`. The owner can reply directly to that Telegram notification and the bot forwards the reply back to the user. Reply threads are tracked via an in-memory `pendingReplies` map with a 7-day TTL.

Note: threading only follows the original notification message. If the owner replies to their own reply, that message is not automatically routed back to the user — only replies to the original forwarded notification are intercepted.

## Project structure

```
├── server.js                        # Express entry point; serves React at /app/
├── routes/
│   ├── cp2.js                    # WebApp + API routes for cp2
│   ├── cp2nus.js                 # WebApp + API routes for cp2nus
│   ├── sutd.js                   # WebApp + API routes for SUTD
│   └── website.js                # Standalone website lookup + feedback API
├── services/
│   ├── cp2Service.js             # Purchase flow: EVS WebPOS scraping + eNETS proxy
│   ├── cp2nusService.js          # Purchase flow: EVS JSON API + eNETS PP + NETS API
│   ├── sutdService.js            # SUTD balance, history, and WebPOS purchase flow
│   ├── ore.js                    # ORE API: meter summary, usage history, top-up history
│   ├── paymentSession.js         # Sealed payment/result tokens and receipt cache
│   ├── paymentNotification.js    # Telegram payment result notification helper
│   ├── paymentSubmitLock.js      # Short-lived duplicate payment submit guard
│   ├── utils.js                  # HTML parsing, result normalisation, XSS escaping
│   ├── validators.js             # Meter ID validation and strict amount parsing
│   ├── config.js                 # Base URLs and shared HTTP headers
│   └── analytics.js              # Event tracking and exception capture
├── bot/
│   ├── index.js                  # Telegraf handlers + webhook/polling runtime
│   ├── handlers/                 # Command and text message handlers
│   ├── services/                 # Bot session, user store, lookup helpers
│   └── constants.js              # Stage names, keyboards, shared messages
├── views/
│   └── errorPage.js              # Shared HTML error page for Express error responses
└── frontend/                     # React + Vite frontend
    ├── src/
    │   ├── App.jsx               # React Router routes
    │   ├── pages/
    │   │   ├── HomePage.jsx      # Hostel selection + meter ID + amount entry
    │   │   ├── LoadingPage.jsx   # Spinner; calls /webapp/bootstrap
    │   │   ├── CardPaymentPage.jsx  # RSA card form; calls /webapp/enets_pay
    │   │   ├── ResultPage.jsx    # Payment outcome
    │   │   └── TermsPage.jsx     # Terms of Use
    │   ├── components/           # Card, DetailRow, Logo, ErrorCard
    │   └── lib/                  # rsa.js, cardBrand.js, validation.js
    └── __tests__/                # Vitest + Testing Library tests
```

## Notes

- Bot sessions are in-memory and expire after 15 minutes. Payment tokens are sealed and restart-safe if `PAYMENT_SESSION_SECRET` is stable; pending payment tokens expire after 10 minutes, completed result tokens after 24 hours. The user store (saved meter IDs) is SQLite-backed and persists across restarts.
- `/webapp/enets_pay` uses a process-local submit lock keyed by merchant transaction reference to reject duplicate in-flight payment submits with HTTP 409.
- Card details are RSA-encrypted in the browser before being sent to the server. The server never sees plaintext card numbers or CVVs.
- The cp2nus flow distinguishes between the top-level `netsMid` (`UMID_xxx`) and `paymtNetsMid` (acquiring MID from `paymtSvcInfoList[0]`). Using the wrong MID will cause the payment to fail silently.
- Accepted top-up amount input is strict: plain numbers plus common currency prefixes such as `$10` or `S$ 10.00`; malformed mixed strings are rejected. NUS minimum top-up is **$6.00 SGD**, SUTD minimum top-up is **$10.00 SGD**, and all systems currently cap top-ups at **$50.00 SGD**.
- The website entry point (`/app/`) and the Telegram Mini App use the same Express routes and React pages — no separate codepaths.
- Global maintenance mode can be enabled at runtime with `/maintenanceon` (owner command) or at startup with `MAINTENANCE_MODE=true`. Users see the global maintenance message across the app and bot; `/health` and Telegram webhooks remain available so the service stays reachable and the owner can run `/maintenanceoff`. Set `MAINTENANCE_MESSAGE` to customize the copy. `GLOBAL_MAINTENANCE=true` is accepted as a legacy alias.
- Top-ups can be disabled at runtime with `/topupoff` (owner command) or at startup with `TOPUP_DISABLED=true`. Bot users in an active top-up session when the flag is set will have their session reset and see the maintenance message. Website payment start, loading, card, bootstrap, and card-submit routes also return the maintenance response while top-ups are disabled; lookup, terms, result, and feedback routes remain available.
