# BPO Readiness server

The live version of the site: class booking, PayMongo payments, refunds and reschedules, class reminders, the required post-class survey, an owner admin page and a leader portal.

Built with Node.js, Express and PostgreSQL. Runs in **test mode** (built-in test payment gateway, emails and SMS written to a log) until you switch on real payments.

## Pages

| URL | Who | What |
|---|---|---|
| `/` | Everyone | Home page; "Book a seat" opens the class schedule |
| `/booking/<token>` | Student (link in their email) | Payment status, reschedule, refund, survey link |
| `/survey/<token>` | Student | Required survey; unlocks class notes and certificate |
| `/admin` | Owner | Dashboard, classes, leaders, referral codes, activity |
| `/leader` | BPO Experience Leaders | Their classes, roster names, attendance, combined ratings |

## Rules the server enforces

- 10 seats per class. Seats are held for 60 minutes while the student pays.
- A seat is confirmed only by the payment gateway's signed webhook, never by the browser coming back from checkout.
- A payment that arrives after the hold ended is accepted if a seat is still free; otherwise it's refunded automatically.
- 48 hours before class: 5 or more paid students confirms the class; fewer cancels it, and students choose a full refund or a free move.
- Full refund until 48 hours before; one free reschedule until 24 hours before.
- The personal class link is emailed 24 hours before (or right after payment, for late bookings).
- Leaders see student names only, mark attendance after class starts, and see ratings only once 3 or more students have answered.
- Marking a student attended sends the required survey; reminders go out at 24 and 48 hours.

## Going live: step by step

You need accounts in your business's name. Nothing here can be done for you.

1. **Database.** Create a free project at [Supabase](https://supabase.com) or [Neon](https://neon.tech). Copy the connection string (Postgres URL).
2. **Hosting.** Create a [Render](https://render.com) account, choose **New → Blueprint**, and pick this GitHub repository. Render reads `render.yaml`.
   - Set `DATABASE_URL` to the connection string from step 1.
   - Set `BASE_URL` to your site's address, for example `https://bpo-readiness.onrender.com` (later your own domain).
   - Render's free plan sleeps when idle, which pauses the scheduled checks. Use a paid instance for real classes.
3. **Your owner login.** In Render, open the service's **Shell** and run:
   ```
   OWNER_EMAIL=you@example.com OWNER_NAME="Ann" OWNER_PASSWORD="a-long-password" npm run create-owner
   ```
   Then sign in at `/admin`.
4. **Test everything in test mode.** Add leaders and classes, book a seat, pay on the test gateway, mark attendance at `/leader`, take the survey. Messages appear under **Activity**.
5. **PayMongo (after your account is approved).**
   - In PayMongo's dashboard, get your **test** secret key (`sk_test_…`).
   - Create a webhook pointing to `https://<your site>/webhooks/payments` for the event `checkout_session.payment.paid`. Copy its signing secret.
   - In Render set `PAYMENTS_PROVIDER=paymongo`, `PAYMONGO_SECRET_KEY=sk_test_…`, `PAYMENTS_WEBHOOK_SECRET=<signing secret>`.
   - Book a seat and pay with PayMongo's test methods. Confirm the booking turns to **Booked**.
   - **Check `src/payments/paymongo.js` against PayMongo's current API reference first.** It was written without access to their docs.
   - When everything works, swap in your live key (`sk_live_…`) and live webhook secret.
6. **Email and SMS.** Create accounts at [Resend](https://resend.com) (email) and [Semaphore](https://semaphore.co) (SMS). Set `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `SMS_DRIVER=semaphore`, `SEMAPHORE_API_KEY`. Check `src/notify.js` against their docs.
7. **Launch gates.** Don't take real payments until the lawyer has signed off the Terms, Privacy Notice and agreements, and BIR registration and receipts are set up.

All settings are listed in `.env.example`.

## Running it locally

```
cd server
npm install
cp .env.example .env     # fill in DATABASE_URL and SESSION_SECRET, then export the values
npm run migrate
npm run seed-demo        # optional: 2 demo leaders, 2 codes, 4 classes (test mode only)
npm start
```

## Tests

`npm test` starts a throwaway PostgreSQL (needs PostgreSQL installed) or uses `TEST_DATABASE_URL` (that database is wiped) and runs end-to-end tests: webhook-only confirmation and signature checks, the 10-seat limit under simultaneous bookings, hold expiry and late payments, the 48-hour minimum, link timing, refund and reschedule windows, attendance, the survey, certificate, leader privacy, and admin access.

## Not built yet

- Over-the-counter payments (7-Eleven, Cebuana): confirm whether PayMongo supports them for your account, or use Dragonpay or Xendit.
- BIR-compliant official receipts: the booking email says "Official receipt" but isn't one. Ask your accountant which receipt system to use.
- Automatic leader payouts and commission payments: the dashboard shows what you owe; you pay them yourself.
