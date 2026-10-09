// Owner-only API: dashboard data and managing classes, leaders and referral codes.
const express = require("express");
const { query, logEvent } = require("../db");
const { config } = require("../config");
const { requireRole, hashPassword } = require("../auth");
const clock = require("../clock");
const B = require("../bookings");
const notify = require("../notify");
const { runJobs } = require("../jobs");

const r = express.Router();
r.use("/api/admin", requireRole("owner"));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const DAY = 86400000;

// Manila local "YYYY-MM-DDTHH:MM" → Date (Manila is UTC+8, no daylight saving).
function manilaLocal(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new B.UserError("Enter the date and time.");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]));
}

r.get("/api/admin/dashboard", wrap(async (req, res) => {
  const now = clock.now();
  const from = new Date(now.getTime() - 28 * DAY);
  const classes = (await query(
    `SELECT c.id, c.starts_at, c.status, COALESCE(u.name, 'To be announced') AS leader,
       (SELECT count(*)::int FROM bookings b WHERE b.class_id = c.id AND b.status IN ('paid','attended','noshow')) AS taken
     FROM classes c LEFT JOIN users u ON u.id = c.leader_id WHERE c.starts_at >= $1 AND c.starts_at <= $2 ORDER BY c.starts_at`, [from, now])).rows;
  const ids = classes.map((c) => c.id);
  const bookings = ids.length ? (await query(
    `SELECT b.class_id, b.name, b.status, b.referral_code, b.attended_at, s.q1, s.q2, s.q3, s.q4, s.q5, s.nps, s.comment, s.submitted_at
     FROM bookings b LEFT JOIN surveys s ON s.booking_id = b.id
     WHERE b.class_id = ANY($1) AND b.status IN ('paid','attended','noshow','refunded')`, [ids])).rows : [];
  const upcoming = (await query(
    `SELECT c.starts_at, c.status, (SELECT count(*)::int FROM bookings b WHERE b.class_id = c.id AND (b.status = 'paid' OR (b.status = 'pending' AND b.hold_until > $1))) AS taken
     FROM classes c WHERE c.starts_at > $1 ORDER BY c.starts_at LIMIT 20`, [now])).rows;
  res.json({
    now: now.getTime(), price: config.price,
    classes: classes.map((c) => ({ id: c.id, start: new Date(c.starts_at).getTime(), leader: c.leader, taken: c.taken, cancelled: c.status === "cancelled" })),
    bookings: bookings.map((b) => ({
      classId: b.class_id, name: b.name, status: b.status, referral: b.referral_code,
      attendedAt: b.attended_at ? new Date(b.attended_at).getTime() : null,
      survey: b.submitted_at ? { at: new Date(b.submitted_at).getTime(), q1: b.q1, q2: b.q2, q3: b.q3, q4: b.q4, q5: b.q5, nps: b.nps, comment: b.comment || "" } : null,
    })),
    upcoming: upcoming.map((c) => ({ start: new Date(c.starts_at).getTime(), taken: c.taken, cancelled: c.status === "cancelled" })),
  });
}));

r.get("/api/admin/classes", wrap(async (req, res) => {
  const now = clock.now();
  const { rows } = await query(
    `SELECT c.*, u.name AS leader_name,
       (SELECT count(*)::int FROM bookings b WHERE b.class_id = c.id AND (b.status IN ('paid','attended','noshow') OR (b.status = 'pending' AND b.hold_until > $1))) AS taken
     FROM classes c LEFT JOIN users u ON u.id = c.leader_id
     WHERE c.starts_at >= $2 ORDER BY c.starts_at`, [now, new Date(now.getTime() - 14 * DAY)]);
  res.json({ classes: rows.map((c) => ({ id: c.id, startsAt: c.starts_at, leaderId: c.leader_id, leader: c.leader_name, status: c.status, zoomLink: c.zoom_link, taken: c.taken, capacity: c.capacity, past: new Date(c.starts_at) < now })) });
}));

r.post("/api/admin/classes", wrap(async (req, res) => {
  const startsAt = manilaLocal(req.body.startsAt);
  if (startsAt <= clock.now()) throw new B.UserError("Pick a time in the future.");
  const leaderId = req.body.leaderId ? Number(req.body.leaderId) : null;
  const zoom = String(req.body.zoomLink || "").trim() || null;
  if (zoom && !/^https:\/\//.test(zoom)) throw new B.UserError("The class link should start with https://");
  const { rows } = await query("INSERT INTO classes (starts_at, leader_id, zoom_link) VALUES ($1,$2,$3) RETURNING id", [startsAt, leaderId, zoom]);
  await logEvent(null, { classId: rows[0].id, message: `Class ${rows[0].id} created by ${req.user.name}.` });
  res.status(201).json({ id: rows[0].id });
}));

r.patch("/api/admin/classes/:id", wrap(async (req, res) => {
  const zoom = req.body.zoomLink === undefined ? undefined : String(req.body.zoomLink || "").trim() || null;
  if (zoom && !/^https:\/\//.test(zoom)) throw new B.UserError("The class link should start with https://");
  await query(`UPDATE classes SET leader_id = COALESCE($1, leader_id), zoom_link = CASE WHEN $2::boolean THEN $3 ELSE zoom_link END WHERE id = $4`,
    [req.body.leaderId ? Number(req.body.leaderId) : null, zoom !== undefined, zoom ?? null, Number(req.params.id)]);
  res.json({ ok: true });
}));

r.post("/api/admin/classes/:id/cancel", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query("UPDATE classes SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' AND starts_at > $2 RETURNING *", [id, clock.now()]);
  if (!rows[0]) throw new B.UserError("That class can't be cancelled.", 409);
  await logEvent(null, { classId: id, message: `Class ${id} cancelled by ${req.user.name}.` });
  const booked = await query("SELECT * FROM bookings WHERE class_id = $1 AND status IN ('paid','pending')", [id]);
  for (const b of booked.rows) {
    if (b.status === "pending") { await query("UPDATE bookings SET status = 'expired' WHERE id = $1", [b.id]); continue; }
    await notify.email(b.email, "Your class won't run: choose a refund or a free move",
      `Hi ${b.name},\n\nWe're sorry: your class on ${B.fmtWhen(rows[0].starts_at)} won't run.\nChoose a full refund or a free move to another class here: ${B.manageUrl(b)}`);
  }
  res.json({ ok: true, notified: booked.rows.filter((b) => b.status === "paid").length });
}));

r.get("/api/admin/classes/:id/bookings", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.ref, b.name, b.email, b.mobile, b.status, b.referral_code, b.paid_at, EXISTS (SELECT 1 FROM surveys s WHERE s.booking_id = b.id) AS survey
     FROM bookings b WHERE b.class_id = $1 AND b.status NOT IN ('failed') ORDER BY b.created_at`, [Number(req.params.id)]);
  res.json({ bookings: rows });
}));

r.get("/api/admin/leaders", wrap(async (req, res) => {
  const { rows } = await query("SELECT id, name, email, active FROM users WHERE role = 'leader' ORDER BY name");
  res.json({ leaders: rows });
}));
r.post("/api/admin/leaders", wrap(async (req, res) => {
  const name = String(req.body.name || "").trim(), email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new B.UserError("Enter the leader's name and email.");
  if (pw.length < 10) throw new B.UserError("Use a temporary password of at least 10 characters.");
  const exists = await query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (exists.rows[0]) throw new B.UserError("Someone already uses that email.", 409);
  await query("INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'leader',$3)", [email, name, hashPassword(pw)]);
  res.status(201).json({ ok: true });
}));
r.patch("/api/admin/leaders/:id", wrap(async (req, res) => {
  await query("UPDATE users SET active = $1 WHERE id = $2 AND role = 'leader'", [Boolean(req.body.active), Number(req.params.id)]);
  res.json({ ok: true });
}));

r.get("/api/admin/codes", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, (SELECT count(*)::int FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.referral_code = r.code AND b.status IN ('attended','noshow')) AS counted
     FROM referral_codes r ORDER BY r.created_at`);
  res.json({ codes: rows });
}));
r.post("/api/admin/codes", wrap(async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase(), partner = String(req.body.partner || "").trim();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new B.UserError("Codes use 3–20 letters and numbers.");
  if (!partner) throw new B.UserError("Enter who the code belongs to.");
  const ins = await query("INSERT INTO referral_codes (code, partner) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING code", [code, partner]);
  if (!ins.rows[0]) throw new B.UserError("That code already exists.", 409);
  res.status(201).json({ ok: true });
}));
r.patch("/api/admin/codes/:code", wrap(async (req, res) => {
  await query("UPDATE referral_codes SET active = $1 WHERE code = $2", [Boolean(req.body.active), String(req.params.code)]);
  res.json({ ok: true });
}));

r.get("/api/admin/activity", wrap(async (req, res) => {
  const events = (await query("SELECT message, created_at FROM events ORDER BY id DESC LIMIT 40")).rows;
  const outbox = (await query("SELECT channel, recipient, subject, body, status, created_at FROM outbox ORDER BY id DESC LIMIT 30")).rows;
  res.json({ events, outbox, testMode: config.testMode });
}));

r.post("/api/admin/run-jobs", wrap(async (req, res) => res.json(await runJobs())));

module.exports = r;
