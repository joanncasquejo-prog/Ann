// Leader API: own classes, roster names, attendance, combined ratings.
const express = require("express");
const { query } = require("../db");
const { requireRole } = require("../auth");
const clock = require("../clock");
const B = require("../bookings");

const r = express.Router();
r.use("/api/leader", requireRole("leader", "owner"));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const MIN_RESPONSES = 3; // fewer than this could identify a student

r.get("/api/leader/classes", wrap(async (req, res) => {
  const now = clock.now();
  const { rows } = await query(
    `SELECT c.id, c.starts_at, c.status, c.zoom_link FROM classes c
     WHERE c.leader_id = $1 AND c.starts_at >= $2 ORDER BY c.starts_at LIMIT 30`, [req.user.id, new Date(now.getTime() - 7 * 86400000)]);
  const out = [];
  for (const c of rows) {
    const roster = (await query(
      `SELECT id, name, status FROM bookings WHERE class_id = $1 AND status IN ('paid','attended','noshow') ORDER BY name`, [c.id])).rows;
    out.push({ id: c.id, startsAt: c.starts_at, status: c.status, zoomLink: c.zoom_link, started: new Date(c.starts_at) <= now, roster });
  }
  res.json({ classes: out });
}));

r.post("/api/leader/attendance", wrap(async (req, res) => {
  await B.markAttendance(req.user, req.body.bookingId, req.body.status);
  res.json({ ok: true });
}));

r.get("/api/leader/ratings", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n, avg(q1) AS q1, avg(q2) AS q2, avg(q3) AS q3, avg(q4) AS q4, avg(q5) AS q5,
       100.0 * (count(*) FILTER (WHERE nps >= 9) - count(*) FILTER (WHERE nps <= 6)) / NULLIF(count(*), 0) AS nps
     FROM surveys s JOIN bookings b ON b.id = s.booking_id JOIN classes c ON c.id = b.class_id WHERE c.leader_id = $1`, [req.user.id]);
  const x = rows[0];
  if (x.n < MIN_RESPONSES) return res.json({ responses: x.n, enough: false });
  const f = (v) => Math.round(Number(v) * 10) / 10;
  res.json({ responses: x.n, enough: true, overall: f(x.q1), clear: f(x.q2), feedback: f(x.q3), everyoneSpoke: f(x.q4), moreReady: f(x.q5), nps: Math.round(Number(x.nps)) });
}));

module.exports = r;
