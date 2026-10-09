const { config } = require("../config");
const provider = config.payments.provider === "paymongo" ? require("./paymongo") : require("./mock");

// Reads a PayMongo-format webhook event into the fields we need.
function parseEvent(body) {
  const event = body && body.data;
  const attrs = event && event.attributes;
  const resource = attrs && attrs.data;
  if (!event || !attrs || !resource) return null;
  const r = resource.attributes || {};
  return {
    id: event.id,
    type: attrs.type,
    livemode: Boolean(attrs.livemode),
    checkoutId: resource.id,
    paymentId: r.payments && r.payments[0] && r.payments[0].id,
    bookingRef: (r.metadata && r.metadata.booking_ref) || r.reference_number,
  };
}

module.exports = { provider, parseEvent };
