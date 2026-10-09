// Email and SMS. Every message is written to the outbox table; real sending
// is switched on with EMAIL_DRIVER=resend and SMS_DRIVER=semaphore.
const { config } = require("./config");
const { query } = require("./db");

async function email(to, subject, body) {
  let status = "logged";
  if (config.notify.emailDriver === "resend") {
    // Resend REST API. Verify against https://resend.com/docs before going live.
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.notify.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.notify.emailFrom, to: [to], subject, text: body }),
    }).catch((e) => ({ ok: false, statusText: e.message }));
    status = r.ok ? "sent" : `failed: ${r.status || ""} ${r.statusText || ""}`.trim();
  }
  await query("INSERT INTO outbox (channel, recipient, subject, body, status) VALUES ('email', $1, $2, $3, $4)", [to, subject, body, status]);
}

async function sms(to, body) {
  let status = "logged";
  if (config.notify.smsDriver === "semaphore") {
    // Semaphore REST API. Verify against https://semaphore.co/docs before going live.
    const form = new URLSearchParams({ apikey: config.notify.semaphoreApiKey, number: to, message: body, sendername: config.notify.smsSender });
    const r = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body: form }).catch((e) => ({ ok: false, statusText: e.message }));
    status = r.ok ? "sent" : `failed: ${r.status || ""} ${r.statusText || ""}`.trim();
  }
  await query("INSERT INTO outbox (channel, recipient, subject, body, status) VALUES ('sms', $1, NULL, $2, $3)", [to, body, status]);
}

module.exports = { email, sms };
