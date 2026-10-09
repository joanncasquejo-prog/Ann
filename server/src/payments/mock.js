// Test gateway: a local checkout page that sends signed webhooks exactly like
// PayMongo would. Only mounted when PAYMENTS_PROVIDER=mock.
const crypto = require("crypto");
const { config } = require("../config");

async function createCheckout(booking) {
  const id = "mock_cs_" + crypto.randomBytes(8).toString("hex");
  return { id, url: `${config.baseUrl}/mock-checkout/${id}` };
}

async function refund(booking) {
  return { id: "mock_ref_" + crypto.randomBytes(6).toString("hex"), amount: booking.amount };
}

module.exports = { name: "mock", createCheckout, refund };
