// Time-based rules. Runs every few minutes; every step is safe to repeat.
const { query, logEvent } = require("./db");
const clock = require("./clock");
const { RULES, HOUR } = require("./rules");
const notify = require("./notify");
const B = require("./bookings");

async function runJobs() {
  const now = clock.now();
  const report = { expired: 0, confirmed: 0, cancelled: 0, links: 0, reminders: 0 };

  // 1. Release seat holds that weren't paid in time.
  const exp = await query("UPDATE bookings SET status = 'expired' WHERE status = 'pending' AND hold_until <= $1 RETURNING id, ref", [now]);
  for (const b of exp.rows) await logEvent(null, { bookingId: b.id, message: `Seat hold for ${b.ref} expired unpaid.` });
  report.expired = exp.rowCount;

  // 2. 48-hour minimum check.
  const due = await query("SELECT * FROM classes WHERE status = 'scheduled' AND starts_at <= $1 AND starts_at > $2",
    [new Date(now.getTime() + RULES.minimumCheckHours * HOUR), now]);
  for (const cls of due.rows) {
    const paid = (await query("SELECT count(*)::int AS n FROM bookings WHERE class_id = $1 AND status = 'paid'", [cls.id])).rows[0].n;
    if (paid >= cls.min_students) {
      await query("UPDATE classes SET status = 'confirmed' WHERE id = $1", [cls.id]);
      await logEvent(null, { classId: cls.id, message: `Class ${cls.id} confirmed with ${paid} students.` });
      report.confirmed++;
    } else {
      await query("UPDATE classes SET status = 'cancelled' WHERE id = $1", [cls.id]);
      await logEvent(null, { classId: cls.id, message: `Class ${cls.id} cancelled: ${paid} students, minimum ${cls.min_students}.` });
      const booked = await query("SELECT * FROM bookings WHERE class_id = $1 AND status IN ('paid', 'pending')", [cls.id]);
      for (const b of booked.rows) {
        if (b.status === "pending") { await query("UPDATE bookings SET status = 'expired' WHERE id = $1", [b.id]); continue; }
        await notify.email(b.email, "Your class won't run: choose a refund or a free move",
          `Hi ${b.name},\n\nYour class on ${B.fmtWhen(cls.starts_at)} didn't reach ${cls.min_students} students, so it won't run.\nChoose a full refund or a free move to another class here: ${B.manageUrl(b)}`);
      }
      report.cancelled++;
    }
  }

  // 3. Personal class links 24 hours before.
  const links = await query(
    `SELECT b.*, c.starts_at, c.zoom_link, c.status AS class_status FROM bookings b JOIN classes c ON c.id = b.class_id
     WHERE b.status = 'paid' AND NOT b.link_sent AND c.status = 'confirmed' AND c.starts_at <= $1 AND c.starts_at > $2`,
    [new Date(now.getTime() + RULES.linkHours * HOUR), now]);
  for (const b of links.rows) { await B.sendClassLink(b, b); report.links++; }

  // 4. Survey reminders at 24 and 48 hours.
  const pending = await query(
    `SELECT b.* FROM bookings b WHERE b.status = 'attended' AND b.attended_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s.booking_id = b.id) AND b.reminders_sent < $1`, [RULES.surveyReminderHours.length]);
  for (const b of pending.rows) {
    const since = (now - new Date(b.attended_at)) / HOUR;
    const dueCount = RULES.surveyReminderHours.filter((h) => since >= h).length;
    if (dueCount > b.reminders_sent) {
      await notify.email(b.email, "Reminder: your class survey", `Hi ${b.name},\n\nYour 2-minute survey is required to get your class notes and certificate of attendance:\n${B.surveyUrl(b)}`);
      await query("UPDATE bookings SET reminders_sent = $1 WHERE id = $2", [dueCount, b.id]);
      report.reminders++;
    }
  }
  return report;
}

module.exports = { runJobs };
