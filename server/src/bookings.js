// Booking lifecycle: hold a seat, confirm by webhook only, refund, reschedule,
// attendance and the required survey.
const crypto = require("crypto");
const { config } = require("./config");
const { query, tx, logEvent } = require("./db");
const clock = require("./clock");
const { RULES, HOUR, hoursUntil, isBookable, bookingOptions } = require("./rules");
const { provider } = require("./payments");
const notify = require("./notify");

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const fmtWhen = (d) => {
  const opts = { timeZone: "Asia/Manila" };
  const s = new Date(d);
  const e = new Date(s.getTime() + RULES.classHours * HOUR);
  return `${s.toLocaleDateString("en-PH", { ...opts, weekday: "short", month: "short", day: "numeric" })}, ${s.toLocaleTimeString("en-PH", { ...opts, hour: "numeric", minute: "2-digit" })}–${e.toLocaleTimeString("en-PH", { ...opts, hour: "numeric", minute: "2-digit" })}`;
};
const manageUrl = (b) => `${config.baseUrl}/booking/${b.token}`;
const surveyUrl = (b) => `${config.baseUrl}/survey/${b.token}`;

// Seats that count against capacity: paid, attended, no-show, and unexpired holds.
const SEAT_SQL = `SELECT count(*)::int AS n FROM bookings
  WHERE class_id = $1 AND (status IN ('paid', 'attended', 'noshow') OR (status = 'pending' AND hold_until > $2))`;

async function seatsTaken(db, classId, now) {
  const { rows } = await db.query(SEAT_SQL, [classId, now]);
  return rows[0].n;
}

async function listBookableClasses() {
  const now = clock.now();
  const { rows } = await query(
    `SELECT c.*, u.name AS leader_name FROM classes c LEFT JOIN users u ON u.id = c.leader_id
     WHERE c.starts_at > $1 AND c.status <> 'cancelled' ORDER BY c.starts_at`, [now]);
  const out = [];
  for (const c of rows) {
    if (!isBookable(c, now)) continue;
    const taken = await seatsTaken({ query }, c.id, now);
    out.push({ id: c.id, startsAt: c.starts_at, leader: c.leader_name || "To be announced", capacity: c.capacity, seatsLeft: Math.max(0, c.capacity - taken) });
  }
  return out;
}

function validateDetails(d) {
  const name = String(d.name || "").trim().slice(0, 120);
  const email = String(d.email || "").trim().toLowerCase().slice(0, 200);
  const m = String(d.mobile || "").replace(/[\s-]/g, "").match(/^(?:\+?63|0)(9\d{9})$/);
  const referral = String(d.referral || "").trim().toUpperCase();
  if (!name) throw new UserError("Enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
  if (!m) throw new UserError("Enter a PH mobile number like 0917 123 4567.");
  if (referral && !/^[A-Z0-9]{3,20}$/.test(referral)) throw new UserError("Referral codes use 3–20 letters and numbers only.");
  if (d.acceptTerms !== true) throw new UserError("Tick the Terms of Service box to continue.");
  if (d.acceptPrivacy !== true) throw new UserError("Tick the Privacy Notice box to continue.");
  return { name, email, mobile: "+63" + m[1], referral: referral || null };
}

async function createBooking(input) {
  const d = validateDetails(input);
  const classId = Number(input.classId);
  const now = clock.now();
  if (d.referral) {
    const { rows } = await query("SELECT 1 FROM referral_codes WHERE code = $1 AND active", [d.referral]);
    if (!rows[0]) throw new UserError("We don't recognise that referral code. Check it, or leave it blank.");
  }
  const booking = await tx(async (db) => {
    const { rows } = await db.query("SELECT * FROM classes WHERE id = $1 FOR UPDATE", [classId]);
    const cls = rows[0];
    if (!cls || !isBookable(cls, now)) throw new UserError("That class is no longer open for booking. Pick another class.", 409);
    if ((await seatsTaken(db, cls.id, now)) >= cls.capacity) throw new UserError("That class just filled up. Pick another class.", 409);
    const ref = "BR-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const token = crypto.randomBytes(24).toString("base64url");
    const hold = new Date(now.getTime() + config.holdMinutes * 60000);
    const ins = await db.query(
      `INSERT INTO bookings (ref, token, class_id, name, email, mobile, referral_code, amount, status, hold_until, consented_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10) RETURNING *`,
      [ref, token, cls.id, d.name, d.email, d.mobile, d.referral, config.price, hold, now]);
    await logEvent(db, { bookingId: ins.rows[0].id, classId: cls.id, message: `Seat held until ${hold.toISOString()} for ${ref}.` });
    return { ...ins.rows[0], cls };
  });
  try {
    const checkout = await provider.createCheckout(booking, booking.cls);
    await query("UPDATE bookings SET checkout_id = $1 WHERE id = $2", [checkout.id, booking.id]);
    return { ref: booking.ref, token: booking.token, checkoutUrl: checkout.url };
  } catch (err) {
    await query("UPDATE bookings SET status = 'failed' WHERE id = $1", [booking.id]);
    await logEvent(null, { bookingId: booking.id, message: `Checkout creation failed: ${err.message}` });
    throw new UserError("We couldn't start the payment. Please try again in a few minutes.", 502);
  }
}

// Called only from a verified webhook.
async function handlePaymentEvent(evt) {
  const fresh = await query("INSERT INTO payment_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id", [evt.id, evt.type]);
  if (!fresh.rows[0]) return { duplicate: true };
  if (evt.type !== "checkout_session.payment.paid") return { ignored: true };

  const now = clock.now();
  const result = await tx(async (db) => {
    const { rows } = await db.query(
      "SELECT * FROM bookings WHERE checkout_id = $1 OR ref = $2 ORDER BY (checkout_id = $1) DESC LIMIT 1 FOR UPDATE",
      [evt.checkoutId, evt.bookingRef || ""]);
    const b = rows[0];
    if (!b) return { unknown: true };
    await db.query("UPDATE payment_events SET booking_id = $1 WHERE id = $2", [b.id, evt.id]);
    if (["paid", "attended", "noshow", "refunded"].includes(b.status)) return { already: true, b };
    const cls = (await db.query("SELECT * FROM classes WHERE id = $1 FOR UPDATE", [b.class_id])).rows[0];
    let accept = b.status === "pending";
    if (!accept) {
      // Late payment after the hold lapsed: accept only if the seat is still available.
      accept = cls.status !== "cancelled" && new Date(cls.starts_at) > now && (await seatsTaken(db, cls.id, now)) < cls.capacity;
    }
    if (accept) {
      const up = await db.query("UPDATE bookings SET status = 'paid', paid_at = $1, payment_id = $2, hold_until = NULL WHERE id = $3 RETURNING *", [now, evt.paymentId || null, b.id]);
      await logEvent(db, { bookingId: b.id, classId: cls.id, message: `Payment confirmed by webhook for ${b.ref}.` });
      return { paid: true, b: up.rows[0], cls };
    }
    await db.query("UPDATE bookings SET payment_id = $1 WHERE id = $2", [evt.paymentId || null, b.id]);
    return { lateNoSeat: true, b: { ...b, payment_id: evt.paymentId }, cls };
  });

  if (result.paid) {
    const { b, cls } = result;
    await notify.email(b.email, `Booked: BPO Readiness class, ${fmtWhen(cls.starts_at)}`,
      `Hi ${b.name},\n\nYou're booked for ${fmtWhen(cls.starts_at)} (Philippine time).\nReference: ${b.ref}\nAmount paid: PHP ${b.amount}.00\n\nYour personal Zoom link arrives 24 hours before class.\nManage your booking: ${manageUrl(b)}\n\nOfficial receipt: BPO Readiness, ${b.ref}.`);
    await notify.sms(b.mobile, `BPO Readiness: booked for ${fmtWhen(cls.starts_at)}. Ref ${b.ref}. Zoom link arrives 24h before class.`);
    if (cls.status === "confirmed" && hoursUntil(cls.starts_at, now) <= RULES.linkHours) await sendClassLink(b, cls);
  }
  if (result.lateNoSeat) {
    await refundBooking(result.b, "Payment arrived after the seat hold expired and the class was full.");
  }
  return result;
}

async function refundBooking(b, reason) {
  const r = await provider.refund(b);
  await query("UPDATE bookings SET status = 'refunded', refunded_at = $1 WHERE id = $2", [clock.now(), b.id]);
  await logEvent(null, { bookingId: b.id, message: `Refunded PHP ${b.amount} (${r.id}). ${reason}` });
  await notify.email(b.email, `Refund for ${b.ref}`, `Hi ${b.name},\n\nWe've refunded PHP ${b.amount}.00 for booking ${b.ref}. ${reason}\nRefunds can take a few business days to show, depending on your payment method.`);
}

async function getByToken(token) {
  const { rows } = await query(
    `SELECT b.*, c.starts_at, c.status AS class_status, c.zoom_link, u.name AS leader_name,
            (SELECT 1 FROM surveys s WHERE s.booking_id = b.id) AS has_survey
     FROM bookings b JOIN classes c ON c.id = b.class_id LEFT JOIN users u ON u.id = c.leader_id
     WHERE b.token = $1`, [String(token || "")]);
  return rows[0] || null;
}

async function bookingView(token) {
  const b = await getByToken(token);
  if (!b) throw new UserError("We couldn't find that booking.", 404);
  const now = clock.now();
  const opts = bookingOptions(b, { starts_at: b.starts_at, status: b.class_status }, now);
  return {
    ref: b.ref, name: b.name, status: b.status, classId: b.class_id, startsAt: b.starts_at, classStatus: b.class_status,
    leader: b.leader_name || "To be announced", referral: b.referral_code, amount: b.amount,
    holdUntil: b.hold_until, rescheduled: b.rescheduled, linkSent: b.link_sent,
    surveyDone: Boolean(b.has_survey), ...opts,
  };
}

async function cancelForRefund(token) {
  const b = await getByToken(token);
  if (!b) throw new UserError("We couldn't find that booking.", 404);
  const { canRefund } = bookingOptions(b, { starts_at: b.starts_at, status: b.class_status }, clock.now());
  if (!canRefund) throw new UserError("Refunds close 48 hours before class.", 409);
  await refundBooking(b, b.class_status === "cancelled" ? "Your class was cancelled." : "You cancelled at least 48 hours before class.");
}

async function reschedule(token, newClassId) {
  const now = clock.now();
  await tx(async (db) => {
    const { rows } = await db.query(
      `SELECT b.*, c.starts_at, c.status AS class_status FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.token = $1 FOR UPDATE OF b`, [String(token || "")]);
    const b = rows[0];
    if (!b) throw new UserError("We couldn't find that booking.", 404);
    const { canReschedule, freeMove } = bookingOptions(b, { starts_at: b.starts_at, status: b.class_status }, now);
    if (!canReschedule) throw new UserError(b.rescheduled ? "You've already used your free reschedule." : "Rescheduling closes 24 hours before class.", 409);
    const target = (await db.query("SELECT * FROM classes WHERE id = $1 FOR UPDATE", [Number(newClassId)])).rows[0];
    if (!target || target.id === b.class_id || !isBookable(target, now)) throw new UserError("That class isn't open for booking. Pick another class.", 409);
    if ((await seatsTaken(db, target.id, now)) >= target.capacity) throw new UserError("That class is full. Pick another class.", 409);
    await db.query("UPDATE bookings SET class_id = $1, rescheduled = rescheduled OR $2, link_sent = FALSE WHERE id = $3", [target.id, !freeMove, b.id]);
    await logEvent(db, { bookingId: b.id, classId: target.id, message: `${b.ref} moved to class ${target.id}${freeMove ? " (free move, class cancelled)" : ""}.` });
    await notify.email(b.email, `Your class moved to ${fmtWhen(target.starts_at)}`, `Hi ${b.name},\n\nYour seat (${b.ref}) is now in the class on ${fmtWhen(target.starts_at)}.\nManage your booking: ${manageUrl(b)}`);
  });
}

async function sendClassLink(b, cls) {
  const link = cls.zoom_link || "(class link to be added by the owner)";
  await notify.email(b.email, `Your class link: ${fmtWhen(cls.starts_at)}`,
    `Hi ${b.name},\n\nYour class is on ${fmtWhen(cls.starts_at)} (Philippine time).\nJoin here: ${link}\n\nJoin under your booked name (${b.name}); only booked names are admitted. The waiting room closes 15 minutes after the start. Please don't share this link.`);
  await notify.sms(b.mobile, `BPO Readiness: your class starts ${fmtWhen(cls.starts_at)}. Your class link is in your email.`);
  await query("UPDATE bookings SET link_sent = TRUE WHERE id = $1", [b.id]);
}

async function markAttendance(leader, bookingId, status) {
  if (!["attended", "noshow"].includes(status)) throw new UserError("Choose attended or no-show.");
  const now = clock.now();
  const { rows } = await query(
    `SELECT b.*, c.starts_at, c.leader_id FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.id = $1`, [Number(bookingId)]);
  const b = rows[0];
  if (!b || (leader.role === "leader" && b.leader_id !== leader.id)) throw new UserError("That student isn't in your class.", 404);
  if (new Date(b.starts_at) > now) throw new UserError("You can mark attendance once the class has started.", 409);
  if (!["paid", "attended", "noshow"].includes(b.status)) throw new UserError("Only paid seats can be marked.", 409);
  await query("UPDATE bookings SET status = $1, attended_at = CASE WHEN $1 = 'attended' THEN COALESCE(attended_at, $2) ELSE NULL END WHERE id = $3", [status, now, b.id]);
  await logEvent(null, { bookingId: b.id, classId: b.class_id, message: `${leader.name} marked ${b.ref} as ${status}.` });
  if (status === "attended" && b.status !== "attended") {
    await notify.email(b.email, "Required: your 2-minute class survey",
      `Hi ${b.name},\n\nThanks for joining today's class. Please complete your 2-minute survey; it unlocks your class notes and certificate of attendance:\n${surveyUrl(b)}`);
  }
}

async function surveyView(token) {
  const b = await getByToken(token);
  if (!b) throw new UserError("We couldn't find that booking.", 404);
  if (b.status !== "attended") throw new UserError("The survey opens after you attend your class.", 409);
  return { name: b.name, startsAt: b.starts_at, done: Boolean(b.has_survey), certificateUrl: `${config.baseUrl}/certificate/${b.token}` };
}

async function submitSurvey(token, a) {
  const b = await getByToken(token);
  if (!b) throw new UserError("We couldn't find that booking.", 404);
  if (b.status !== "attended") throw new UserError("The survey opens after you attend your class.", 409);
  const num = (v, lo, hi) => (Number.isInteger(Number(v)) && v !== "" && v !== null && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const vals = ["q1", "q2", "q3", "q4", "q5"].map((k) => num(a[k], 1, 5));
  const nps = num(a.nps, 0, 10);
  const missing = vals.map((v, i) => (v === null ? i + 1 : null)).filter(Boolean);
  if (nps === null) missing.push(6);
  if (missing.length) throw new UserError(`Answer question${missing.length > 1 ? "s" : ""} ${missing.join(", ")} to submit.`);
  const comment = String(a.comment || "").trim().slice(0, 1000) || null;
  const ins = await query(
    `INSERT INTO surveys (booking_id, q1, q2, q3, q4, q5, nps, comment, submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (booking_id) DO NOTHING RETURNING booking_id`, [b.id, ...vals, nps, comment, clock.now()]);
  if (!ins.rows[0]) throw new UserError("You've already submitted this survey. Thank you!", 409);
  await logEvent(null, { bookingId: b.id, message: `Survey submitted for ${b.ref}.` });
}

module.exports = {
  UserError, fmtWhen, manageUrl, surveyUrl, seatsTaken, listBookableClasses, createBooking, handlePaymentEvent,
  refundBooking, getByToken, bookingView, cancelForRefund, reschedule, sendClassLink, markAttendance, surveyView, submitSurvey,
};
