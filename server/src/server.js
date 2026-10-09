const { config, assertConfig } = require("./config");
assertConfig();
const { migrate } = require("./db");
const { buildApp } = require("./app");
const { runJobs } = require("./jobs");

(async () => {
  await migrate();
  buildApp().listen(config.port, () => console.log(`BPO Readiness running on ${config.baseUrl} (payments: ${config.payments.provider})`));
  const tick = () => runJobs().then((r) => { if (Object.values(r).some(Boolean)) console.log("jobs", r); }).catch((e) => console.error("jobs failed", e));
  tick();
  setInterval(tick, 5 * 60000);
})();
