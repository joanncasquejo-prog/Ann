// PayMongo Checkout Sessions and Refunds.
// VERIFY BEFORE GOING LIVE: field names below follow PayMongo's v1 API as
// understood when this was written; check them against
// https://developers.paymongo.com/reference before switching to live keys.
const { config } = require("../config");

const API = "https://api.paymongo.com/v1";
const auth = () => "Basic " + Buffer.from(`${config.payments.paymongoSecretKey}:`).toString("base64");

async function call(path, attributes) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ data: { attributes } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = body.errors?.map((e) => e.detail).join("; ") || r.statusText;
    throw new Error(`PayMongo ${path} failed: ${r.status} ${detail}`);
  }
  return body.data;
}

async function createCheckout(booking, cls) {
  const data = await call("/checkout_sessions", {
    line_items: [{
      currency: "PHP",
      amount: booking.amount * 100, // centavos
      name: "BPO Readiness Live Class",
      description: `3-hour live class, ${new Date(cls.starts_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`,
      quantity: 1,
    }],
    payment_method_types: config.payments.methods,
    reference_number: booking.ref,
    description: `Seat for ${booking.name}`,
    send_email_receipt: false,
    show_line_items: true,
    success_url: `${config.baseUrl}/booking/${booking.token}`,
    cancel_url: `${config.baseUrl}/booking/${booking.token}?cancelled=1`,
    metadata: { booking_ref: booking.ref },
  });
  return { id: data.id, url: data.attributes.checkout_url };
}

async function refund(booking) {
  const data = await call("/refunds", {
    amount: booking.amount * 100,
    payment_id: booking.payment_id,
    reason: "requested_by_customer",
  });
  return { id: data.id, amount: booking.amount };
}

module.exports = { name: "paymongo", createCheckout, refund };
