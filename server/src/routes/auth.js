const express = require("express");
const { query } = require("../db");
const A = require("../auth");

const r = express.Router();

r.post("/api/login", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  const key = `${email}|${req.ip}`;
  if (!A.loginAllowed(key)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const { rows } = await query("SELECT * FROM users WHERE email = $1 AND active", [email]);
  if (!rows[0] || !A.verifyPassword(password, rows[0].password_hash)) {
    A.recordFailure(key);
    return res.status(401).json({ error: "Wrong email or password." });
  }
  A.clearFailures(key);
  A.issueSession(res, rows[0].id);
  res.json({ name: rows[0].name, role: rows[0].role });
});

r.post("/api/password", async (req, res) => {
  const id = A.readSession(req);
  if (!id) return res.status(401).json({ error: "Please sign in." });
  const { current, next } = req.body || {};
  if (String(next || "").length < 10) return res.status(400).json({ error: "Use a new password of at least 10 characters." });
  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1 AND active", [id]);
  if (!rows[0] || !A.verifyPassword(String(current || ""), rows[0].password_hash)) return res.status(401).json({ error: "Your current password is wrong." });
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [A.hashPassword(String(next)), id]);
  res.json({ ok: true });
});

r.post("/api/logout", (req, res) => { A.clearSession(res); res.json({ ok: true }); });

r.get("/api/me", async (req, res) => {
  const id = A.readSession(req);
  if (!id) return res.json({ user: null });
  const { rows } = await query("SELECT name, email, role FROM users WHERE id = $1 AND active", [id]);
  res.json({ user: rows[0] || null });
});

module.exports = r;
