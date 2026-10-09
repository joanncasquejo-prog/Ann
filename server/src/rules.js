// Class and booking rules from the business process, in one place.
const HOUR = 3600000;

const RULES = {
  refundCutoffHours: 48,       // full refund if cancelled at least 48h before
  rescheduleCutoffHours: 24,   // one free reschedule until 24h before
  minimumCheckHours: 48,       // classes under the minimum are cancelled at 48h
  linkHours: 24,               // personal class link sent 24h before
  bookingCloseHours: 2,        // booking closes 2h before start
  classHours: 3,
  surveyReminderHours: [24, 48],
};

const hoursUntil = (startsAt, now) => (new Date(startsAt) - now) / HOUR;

// Bookable: not cancelled, still open, and either already confirmed or far
// enough out that the 48-hour minimum check hasn't happened yet.
function isBookable(cls, now) {
  const h = hoursUntil(cls.starts_at, now);
  if (cls.status === "cancelled" || h <= RULES.bookingCloseHours) return false;
  return cls.status === "confirmed" || h > RULES.minimumCheckHours;
}

function bookingOptions(booking, cls, now) {
  const h = hoursUntil(cls.starts_at, now);
  const paid = booking.status === "paid";
  const classCancelled = cls.status === "cancelled";
  return {
    canRefund: paid && (classCancelled || h >= RULES.refundCutoffHours),
    canReschedule: paid && (classCancelled || (h >= RULES.rescheduleCutoffHours && !booking.rescheduled)),
    freeMove: paid && classCancelled,
  };
}

module.exports = { RULES, HOUR, hoursUntil, isBookable, bookingOptions };
