// Test-mode demo data: 2 leaders, 2 referral codes and 4 upcoming classes.
// Refuses to run when payments are live.
const { config } = require("../src/config");
const { migrate, query, pool } = require("../src/db");
const { hashPassword } = require("../src/auth");
(async () => {
  if (config.payments.provider !== "mock") throw new Error("seed-demo only runs in test mode (PAYMENTS_PROVIDER=mock).");
  await migrate();
  const pw = process.env.DEMO_LEADER_PASSWORD || "leader-demo-123";
  for (const [name, email] of [["Marco T.", "marco@example.com"], ["Joy R.", "joy@example.com"]]) {
    await query("INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'leader',$3) ON CONFLICT (email) DO NOTHING", [email, name, hashPassword(pw)]);
  }
  for (const [code, partner] of [["JEN100", "Jen (marketing partner)"], ["TIKTOKBPO", "TikTok affiliate"]]) {
    await query("INSERT INTO referral_codes (code, partner) VALUES ($1,$2) ON CONFLICT DO NOTHING", [code, partner]);
  }
  const leaders = (await query("SELECT id FROM users WHERE role = 'leader' ORDER BY id")).rows;
  const PH = 8 * 3600000, DAY = 86400000;
  const midnight = Math.floor((Date.now() + PH) / DAY) * DAY - PH;
  for (const [days, hour] of [[3, 18], [4, 9], [6, 13], [10, 9]]) {
    await query("INSERT INTO classes (starts_at, leader_id, zoom_link) VALUES ($1,$2,$3)",
      [new Date(midnight + days * DAY + hour * 3600000), leaders[days % leaders.length]?.id || null, "https://zoom.us/j/0000000000"]);
  }
  console.log(`Demo data added. Leader logins: marco@example.com / joy@example.com, password ${pw}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
