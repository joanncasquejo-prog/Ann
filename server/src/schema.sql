-- BPO Readiness schema. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'leader')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id           SERIAL PRIMARY KEY,
  starts_at    TIMESTAMPTZ NOT NULL,
  leader_id    INTEGER REFERENCES users(id),
  capacity     INTEGER NOT NULL DEFAULT 10,
  min_students INTEGER NOT NULL DEFAULT 5,
  status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'cancelled')),
  zoom_link    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classes_starts_at ON classes (starts_at);

CREATE TABLE IF NOT EXISTS referral_codes (
  code       TEXT PRIMARY KEY,
  partner    TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- status: pending (seat held, awaiting payment), paid, expired, failed,
-- refunded, attended, noshow
CREATE TABLE IF NOT EXISTS bookings (
  id             SERIAL PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,
  token          TEXT NOT NULL UNIQUE,
  class_id       INTEGER NOT NULL REFERENCES classes(id),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  mobile         TEXT NOT NULL,
  referral_code  TEXT REFERENCES referral_codes(code),
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'attended', 'noshow')),
  hold_until     TIMESTAMPTZ,
  checkout_id    TEXT UNIQUE,
  payment_id     TEXT,
  rescheduled    BOOLEAN NOT NULL DEFAULT FALSE,
  link_sent      BOOLEAN NOT NULL DEFAULT FALSE,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  consented_at   TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ,
  attended_at    TIMESTAMPTZ,
  refunded_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bookings_class ON bookings (class_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id          TEXT PRIMARY KEY,           -- provider event id, for idempotency
  booking_id  INTEGER REFERENCES bookings(id),
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surveys (
  booking_id   INTEGER PRIMARY KEY REFERENCES bookings(id),
  q1 SMALLINT NOT NULL CHECK (q1 BETWEEN 1 AND 5),
  q2 SMALLINT NOT NULL CHECK (q2 BETWEEN 1 AND 5),
  q3 SMALLINT NOT NULL CHECK (q3 BETWEEN 1 AND 5),
  q4 SMALLINT NOT NULL CHECK (q4 BETWEEN 1 AND 5),
  q5 SMALLINT NOT NULL CHECK (q5 BETWEEN 1 AND 5),
  nps SMALLINT NOT NULL CHECK (nps BETWEEN 0 AND 10),
  comment      TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id         SERIAL PRIMARY KEY,
  channel    TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient  TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'logged',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  class_id   INTEGER REFERENCES classes(id),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
