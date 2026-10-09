const express = require("express");
const B = require("../bookings");
const { config } = require("../config");
const { query } = require("../db");
const clock = require("../clock");
const { provider } = require("../payments");

const r = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

r.get("/api/config", (req, res) => res.json({ price: config.price, testMode: config.testMode }));
r.get("/api/classes", wrap(async (req, res) => res.json({ classes: await B.listBookableClasses() })));
r.post("/api/bookings", wrap(async (req, res) => res.status(201).json(await B.createBooking(req.body || {}))));
r.get("/api/bookings/:token", wrap(async (req, res) => res.json(await B.bookingView(req.params.token))));
r.post("/api/bookings/:token/cancel", wrap(async (req, res) => { await B.cancelForRefund(req.params.token); res.json(await B.bookingView(req.params.token)); }));
r.post("/api/bookings/:token/reschedule", wrap(async (req, res) => { await B.reschedule(req.params.token, (req.body || {}).classId); res.json(await B.bookingView(req.params.token)); }));

// Start a new checkout for a seat that's still held (e.g. after a declined payment).
r.post("/api/bookings/:token/retry", wrap(async (req, res) => {
  const b = await B.getByToken(req.params.token);
  if (!b) throw new B.UserError("We couldn't find that booking.", 404);
  if (b.status !== "pending" || new Date(b.hold_until) <= clock.now()) throw new B.UserError("This seat hold has ended. Please book again.", 409);
  const checkout = await provider.createCheckout(b, b);
  await query("UPDATE bookings SET checkout_id = $1 WHERE id = $2", [checkout.id, b.id]);
  res.json({ checkoutUrl: checkout.url });
}));

r.get("/api/survey/:token", wrap(async (req, res) => res.json(await B.surveyView(req.params.token))));
r.post("/api/survey/:token", wrap(async (req, res) => { await B.submitSurvey(req.params.token, req.body || {}); res.json(await B.surveyView(req.params.token)); }));

module.exports = r;
