// Test-only checkout page standing in for PayMongo. Sends a signed webhook.
const express = require("express");
const crypto = require("crypto");
const { config } = require("../config");
const { query } = require("../db");
const { signPayload } = require("../payments/signature");

const r = express.Router();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function find(id) {
  const { rows } = await query("SELECT * FROM bookings WHERE checkout_id = $1", [id]);
  return rows[0];
}

r.get("/mock-checkout/:id", async (req, res) => {
  const b = await find(req.params.id);
  if (!b) return res.status(404).send("Checkout not found");
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test payment</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="section"><div class="container narrow"><div class="gateway">
<p class="eyebrow">Test payment gateway</p><h2>₱${b.amount}.00 · BPO Readiness</h2>
<p class="muted">Order ${esc(b.ref)} · Seat for ${esc(b.name)}</p>
<p>This page stands in for PayMongo while the server runs in test mode. No money moves.</p>
<form method="post" action="/mock-checkout/${esc(req.params.id)}/pay" class="btn-row"><button class="btn btn-primary">Pay ₱${b.amount} (test)</button></form>
<form method="post" action="/mock-checkout/${esc(req.params.id)}/cancel" class="btn-row" style="margin-top:10px"><button class="btn btn-ghost">Cancel payment</button></form>
</div></div></main></body></html>`);
});

r.post("/mock-checkout/:id/pay", async (req, res) => {
  const b = await find(req.params.id);
  if (!b) return res.status(404).send("Checkout not found");
  const body = JSON.stringify({ data: { id: "evt_mock_" + crypto.randomBytes(8).toString("hex"), type: "event", attributes: {
    type: "checkout_session.payment.paid", livemode: false,
    data: { id: req.params.id, type: "checkout_session", attributes: { reference_number: b.ref, metadata: { booking_ref: b.ref }, payments: [{ id: "pay_mock_" + crypto.randomBytes(6).toString("hex") }] } },
  } } });
  const r2 = await fetch(`http://127.0.0.1:${req.socket.localPort}/webhooks/payments`, {
    method: "POST", headers: { "Content-Type": "application/json", "Paymongo-Signature": signPayload(config.payments.webhookSecret, body) }, body,
  });
  if (!r2.ok) return res.status(502).send("Test webhook failed: " + (await r2.text()));
  res.redirect(303, `/booking/${b.token}`);
});

r.post("/mock-checkout/:id/cancel", async (req, res) => {
  const b = await find(req.params.id);
  if (!b) return res.status(404).send("Checkout not found");
  res.redirect(303, `/booking/${b.token}?cancelled=1`);
});

module.exports = r;
