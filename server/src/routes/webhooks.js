const express = require("express");
const { config } = require("../config");
const { verifySignature } = require("../payments/signature");
const { parseEvent } = require("../payments");
const B = require("../bookings");

const r = express.Router();

// Raw body is required to verify the signature.
r.post("/webhooks/payments", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const evt = parseEvent(body);
  if (!evt) return res.status(400).json({ error: "Unrecognised event" });
  const header = req.get("Paymongo-Signature");
  if (!verifySignature(config.payments.webhookSecret, raw, header, evt.livemode)) return res.status(401).json({ error: "Invalid signature" });
  if (evt.livemode && config.payments.provider !== "paymongo") return res.status(400).json({ error: "Live event sent to a test server" });
  try {
    const result = await B.handlePaymentEvent(evt);
    res.json({ ok: true, result: Object.keys(result)[0] });
  } catch (err) {
    console.error("webhook error", err);
    res.status(500).json({ error: "Processing failed" }); // gateway will retry
  }
});

module.exports = r;
