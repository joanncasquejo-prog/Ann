# BPO Readiness

Website for BPO Readiness: a 3-hour live online class led by a BPO Experience Leader (someone who has led BPO agent teams). ₱799 per seat, maximum 10 students per class.

## Pages
- `index.html`: home page with the class outline, pricing, a free readiness check, class policies and FAQ
- `terms.html`: draft Terms of Service
- `privacy.html`: draft Privacy Notice (Data Privacy Act, RA 10173)

Static HTML/CSS/JS with no build step. To run it locally, open `index.html` or run `python3 -m http.server 8000`.

## Test mode (`app.js`)
"Book a seat" opens a test-mode booking app that runs in the browser. No real money, SMS or email is involved:
- Sample schedule (Philippine time) with live seat counts, a 10-seat cap and full classes.
- Booking details with an optional referral code (counted toward a ₱100 commission once the class runs with no refund), separate Terms and Privacy consent, then checkout with GCash, Maya, card or over-the-counter through a simulated gateway. A seat is confirmed only after the simulated payment-confirmed message from the gateway.
- Over-the-counter payments hold the seat for 24 hours, then release it.
- Rules: full refund until 48 hours before class, one free reschedule until 24 hours before, a minimum of 5 students checked 48 hours before (otherwise refund or free move), class link sent 24 hours before, no-shows forfeit the seat.
- Leader view with the class roster and attendance marking.
- Required post-class survey (5 leader and class ratings, how likely to recommend, optional comment) that unlocks class notes and a certificate of attendance.

## Owner dashboard (`dashboard.js`)
Open with `index.html#dashboard` or the button in the test panel. It combines seeded sample data for the last 4 weeks with your test bookings and shows: alerts, profit after tax, students per class, NPS, leader ratings, survey completion, cancellations, no-shows, refunds, a profit and loss summary, the VAT threshold pace, commission per referral code, leader payouts and ratings, latest comments, pending surveys and upcoming classes at risk.
- Test data is kept in the browser's localStorage and can be cleared with "Reset test".

## Not yet built
Real payments (a PayMongo, Xendit or Dragonpay merchant account plus a webhook server), real SMS and email, a shared class schedule and seat count on a server, and Zoom link generation.
