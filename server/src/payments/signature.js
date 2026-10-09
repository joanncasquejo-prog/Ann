// Webhook signatures in PayMongo's format:
//   Paymongo-Signature: t=<unix seconds>,te=<test-mode signature>,li=<live-mode signature>
// where each signature is HMAC-SHA256(webhook secret, "<t>.<raw request body>") in hex.
// The mock gateway signs its webhooks the same way, so tests exercise this code.
const crypto = require("crypto");

const TOLERANCE_SECONDS = 600;

function signPayload(secret, rawBody, t = Math.floor(Date.now() / 1000), livemode = false) {
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return livemode ? `t=${t},te=,li=${sig}` : `t=${t},te=${sig},li=`;
}

function verifySignature(secret, rawBody, header, livemode) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(",").map((p) => p.split("=").map((s) => s.trim())));
  const t = Number(parts.t);
  const given = livemode ? parts.li : parts.te;
  if (!t || !given || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(given, "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { signPayload, verifySignature };
