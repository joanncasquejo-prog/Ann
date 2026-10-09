// Usage: OWNER_EMAIL=you@example.com OWNER_NAME="Ann" OWNER_PASSWORD="..." npm run create-owner
const { migrate, query, pool } = require("../src/db");
const { hashPassword } = require("../src/auth");
(async () => {
  const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const name = process.env.OWNER_NAME || "Owner";
  const pw = process.env.OWNER_PASSWORD || "";
  if (!email || pw.length < 12) throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters).");
  await migrate();
  await query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'owner',$3)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = 'owner', active = TRUE`, [email, name, hashPassword(pw)]);
  console.log(`Owner account ready: ${email}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
