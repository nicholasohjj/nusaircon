# Scheduled balance check

Have an AI agent check your meter on a schedule and send you a payment link when credit runs low.

**This doesn't pay for you.** The agent stops at the link, and you still enter your card details yourself. That keeps your card out of the AI's reach, and your bank's approval step still works.

## What you need

- An AI agent that can run on a schedule and use MCP tools, such as a routine in Claude Code
- The MCP server added to that agent: `https://nusaircon-production.up.railway.app/mcp`, or [your own copy](self-hosting.md)
- A way for the agent to reach you, such as its own notifications

Your meter ID goes to your AI provider each time this runs. If you only want a Telegram message, the bots already offer this with `/alerts`, with no AI involved.

## Set it up

Schedule the agent to run once a day, and give it one of these prompts. Replace the meter ID and adjust the numbers to suit you.

### NUS meter

```text
Check my NUS electricity meter, 12345678. Do this once, then stop.

1. Call get_meter_usage for my meter.
2. If balanceSgd is at least 5 and estimatedDaysLeft is at least 5, end here
   with a one-line summary. If estimatedDaysLeft is null, go by the balance alone.
3. Otherwise, call get_topup_link for my meter, with system "nus" and
   amount_sgd 20.
4. Tell me the balance, the days left, and the link. If meterVerified is false,
   tell me to check the meter shown on the page before paying.

Rules:
- Never open the link, fill in a payment form, or use a browser or any other
  tool to pay. Only give me the link.
- Never ask me for card details.
- If a tool returns EVS_UNAVAILABLE, or the server doesn't respond, try once more
  after a minute. If it still fails, tell me the check failed. Don't say anything
  about my balance.
- If a tool returns retryable false, tell me the message and stop.
```

### SUTD meter

SUTD has no usage history, so this goes by the balance alone. The minimum top-up is $10.

```text
Check my SUTD electricity meter, 12345678. Do this once, then stop.

1. Call get_meter_balance for my meter, with system "sutd".
2. If balanceSgd is at least 5, end here with a one-line summary.
3. Otherwise, call get_topup_link for my meter, with system "sutd" and
   amount_sgd 20.
4. Tell me the balance and the link. If meterVerified is false, tell me to check
   the meter shown on the page before paying.

Rules:
- Never open the link, fill in a payment form, or use a browser or any other
  tool to pay. Only give me the link.
- Never ask me for card details.
- If a tool returns EVS_UNAVAILABLE, or the server doesn't respond, try once more
  after a minute. If it still fails, tell me the check failed. Don't say anything
  about my balance.
- If a tool returns retryable false, tell me the message and stop.
```

## Confirm a payment

After you pay, you can ask the agent to confirm it:

```text
I just paid using that link. Confirm it with get_recent_topups, following the
tool's instructions. If you can't find it, don't tell me to pay again.
```

## What to expect

- **Repeat reminders:** the agent doesn't remember earlier runs, so it sends a new link every day until you top up.
- **Rough estimates:** EVS readings can be a couple of days behind, so `estimatedDaysLeft` is only a guide. Leave a margin.
- **Slow first response:** the public server sleeps when idle, so the first call can fail while it wakes. That's why the prompts try again.
- **Check before you pay:** make sure the page shows the right meter and amount.
