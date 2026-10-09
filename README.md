# BPO Readiness

Marketing website for the BPO Readiness Solo Pass: unlimited AI mock interviews for BPO job-seekers, PHP 599 for 15 days.

## Pages
- `index.html`: home page with the five interview stages, pricing, a free readiness check, fair-use rules, and FAQ
- `terms.html`: draft Terms of Service
- `privacy.html`: draft Privacy Notice (Data Privacy Act, RA 10173)

Static HTML/CSS/JS with no build step. To run it locally, open `index.html` or run `python3 -m http.server 8000`.

## Test mode (`app.js`)
"Get the Solo Pass" opens a test-mode app that runs in the browser. No real money, SMS or email is involved:
- Sign-up with separate Terms and Privacy consent, an SMS code (3 wrong tries puts the account on hold), and email verification. Codes and emails show up in an on-screen test inbox.
- Checkout with GCash, Maya, card or over-the-counter. A simulated gateway can approve, decline, leave an OTC order pending, or return without paying. Access starts only after the simulated payment-confirmed message from the gateway.
- 15-day pass, 2 devices with 2 swaps, one session at a time, refunds (within 3 days, 3 or fewer interviews), renewal, expiry, chargebacks, and the four-level enforcement ladder.
- AI mock interviews for all five stages, with a feedback report after each. This uses the Claude Artifact `sample` capability, so it only works on the published Artifact page. Voice stages run in text.
- Test data is kept in the browser's localStorage and can be cleared with "Reset test account".

## Not yet built
Real payments (a PayMongo, Xendit or Dragonpay merchant account plus a webhook server), real SMS and email, server-side accounts and device tracking, and voice interviews.
