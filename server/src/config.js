// All settings come from environment variables. See .env.example.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET,
  price: Number(env.PRICE_PESOS || 799),
  holdMinutes: Number(env.HOLD_MINUTES || 60),
  payments: {
    provider: env.PAYMENTS_PROVIDER || "mock", // "mock" or "paymongo"
    paymongoSecretKey: env.PAYMONGO_SECRET_KEY,
    webhookSecret: env.PAYMENTS_WEBHOOK_SECRET,
    methods: (env.PAYMENT_METHODS || "gcash,paymaya,card").split(",").map((s) => s.trim()).filter(Boolean),
  },
  notify: {
    emailDriver: env.EMAIL_DRIVER || "log", // "log" or "resend"
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM || "BPO Readiness <classes@example.com>",
    smsDriver: env.SMS_DRIVER || "log", // "log" or "semaphore"
    semaphoreApiKey: env.SEMAPHORE_API_KEY,
    smsSender: env.SMS_SENDER || "BPOREADY",
  },
  testMode: env.TEST_MODE === "1" || (env.PAYMENTS_PROVIDER || "mock") === "mock",
};

function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push("SESSION_SECRET (at least 32 characters)");
  if (!config.payments.webhookSecret) missing.push("PAYMENTS_WEBHOOK_SECRET");
  if (config.payments.provider === "paymongo" && !config.payments.paymongoSecretKey) missing.push("PAYMONGO_SECRET_KEY");
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
}

module.exports = { config, assertConfig };
