# Self-hosting

Run your own copy of EVS Meter Tools and connect it to your own AI assistant. Your copy is separate from the public service, so you control the bot, the data and any automation you add.

This is an unofficial tool, not affiliated with NUS, SUTD, EVS or eNETS. It is provided under the [MIT licence](../LICENSE) with no warranty. You are responsible for anything your copy or your automation does, including any charge to your card.

## What you get

- The website, the card payment pages and a Telegram bot
- A read-only MCP server at `/mcp`, with tools for balance, usage, recent top-ups and top-up links

The MCP tools cannot make payments, and this repo doesn't include automatic top-ups. If you want them, you have to build them. Read [Building your own automation](#building-your-own-automation) first.

## What you need

- Node.js 20.19 or later (22.12 or later if you use Node 22)
- A Telegram bot token

The token is required even if you only want the MCP server, because the app exits at startup without a valid one. Create a new bot with [@BotFather](https://t.me/BotFather); it's free. Don't reuse a token from a bot that is already running elsewhere.

## Run it on your computer

```bash
git clone https://github.com/nicholasohjj/nusaircon.git
cd nusaircon
npm ci
npm run build
```

Create a `.env` file in the project folder:

```env
TELEGRAM_BOT_TOKEN=your_new_bot_token
TELEGRAM_BOT_AUDIENCE=nus    # or sutd
PAYMENT_SESSION_SECRET=      # output of: openssl rand -hex 32
```

Start the server:

```bash
npm start
```

In a second terminal, check that the MCP server responds:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The response should list `get_meter_balance`, `get_meter_usage`, `get_recent_topups` and `get_topup_link`.

## Connect your AI assistant

**Claude Code on the same computer:**

```bash
claude mcp add --transport http evs-meter http://localhost:3000/mcp
```

**Claude custom connectors:** these need a public HTTPS address, so `localhost` won't work. Deploy your copy first (see below), then add `https://<your-domain>/mcp` as a custom connector.

Any other MCP client that supports Streamable HTTP can use the same address.

The [README](../README.md#connect-your-own-claude-mcp) has an example of instructions to give your assistant.

## Deploy it online

Telegram's Mini App buttons and hosted AI connectors need a public HTTPS address. The repo includes a Railway configuration, and the [README](../README.md#railway-serverless) has the steps. On any host:

- Set `SERVER_URL` to your public HTTPS address, because top-up links are built from it.
- Keep `DB_DIR` on persistent storage, or saved meters are lost when the server restarts.
- Keep `PAYMENT_SESSION_SECRET` the same between deploys, so payments in progress survive a restart.
- Browser-based MCP clients on other sites get a 403 until you add their address to `MCP_ALLOWED_ORIGINS`. Your own domain, localhost and Claude's sites are already allowed, and clients that don't run in a browser aren't affected.
- Run exactly one instance (replica). Payment submit locks, receipts, rate limits and the low-balance check live in the process's memory, so a second instance wouldn't see them and duplicate-payment protection would stop working.

### What changes in a fork

- **Low-balance alerts:** `.github/workflows/low-balance-check.yml` calls the public service's address unless the `LOW_BALANCE_CHECK_URL` repository variable is set. Set that variable to your own deployment before you add `LOW_BALANCE_CRON_SECRET` to your fork, or your secret is sent to the wrong server. GitHub also leaves scheduled workflows off in forks until you enable them.
- **Analytics:** these stay off unless you set your own `POSTHOG_API_KEY`.
- **MCP registry:** `server.json` lists the public service. If you publish your copy to the MCP registry, change its name and address first.
- **Running it for other people:** you become the operator of that service. The included terms describe the public service, so replace them with your own. Your MCP endpoint and lookup routes are also open to anyone who has the address.

## Building your own automation

The usual design is for your AI assistant or a script to check the balance and then act when it runs low. The safest version stops at sending you a top-up link, using `get_topup_link`, so you still pay yourself. The [scheduled balance check](scheduled-balance-check.md) has ready-made prompts for this.

Paying without you involves real risks that this project can't remove:

- **Bank approval (3DS):** if your bank asks for an OTP or app approval, an unattended payment can't finish. This app treats that page as a failed payment (`services/utils.js`). Your bank decides when to ask, so a payment that worked last week may not work today.
- **Duplicate charges:** a timeout doesn't mean the payment failed. Check your recent top-ups and your card statement before trying again, and never retry automatically after an unclear result.
- **Card details:** anything that pays for you needs access to your card. Don't put card details in AI chats, prompts, logs or a repo.
- **Prompt injection:** don't give an AI assistant direct access to a payment tool. Text it reads from elsewhere could influence what it does.
- **Third-party rules:** this tool uses EVS and eNETS systems without a partnership, and they can change or block access at any time. Check their terms, and your card issuer's, before automating payments.

If you go ahead anyway:

- Enforce the limits in your code, not in the AI's instructions: a fixed meter ID, a fixed amount, a monthly cap and a minimum gap between top-ups.
- Send yourself a notification for every attempt, whatever the result.
- Stop after any failure until you've looked at it yourself.
- Make checks gentle, such as once a day, so you don't burden EVS systems.

The [README](../README.md#payment-flows) describes how each payment flow works.
