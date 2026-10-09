const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");
const { runJobs } = require("../src/jobs");
const { signPayload } = require("../src/payments/signature");

let srv, c;
before(async () => { srv = await H.startServer(); });
after(async () => { srv.server.close(); await H.pool.end(); });
beforeEach(async () => { await H.resetDb(); c = H.client(srv.base); });

const status = async (token) => (await c.get(`/api/bookings/${token}`)).data;

test("booking is confirmed only by a signed webhook, and sends a receipt", async () => {
  const cls = await H.addClass(120);
  const list = await c.get("/api/classes");
  assert.equal(list.data.classes[0].seatsLeft, 10);
  const b = await c.post("/api/bookings", H.details(cls));
  assert.equal(b.status, 201);
  assert.equal((await status(b.data.token)).status, "pending");
  const page = await c.get(new URL(b.data.checkoutUrl).pathname);
  assert.equal(page.status, 200);
  const pay = await c.req(new URL(b.data.checkoutUrl).pathname + "/pay", { method: "POST" });
  assert.equal(pay.status, 303);
  const v = await status(b.data.token);
  assert.equal(v.status, "paid");
  assert.equal(v.canRefund, true);
  const { rows } = await H.query("SELECT subject FROM outbox WHERE channel = 'email'");
  assert.match(rows[0].subject, /^Booked:/);
});

test("webhooks with a bad signature are rejected, and replays are ignored", async () => {
  const cls = await H.addClass(120);
  const b = await c.post("/api/bookings", H.details(cls));
  const { rows } = await H.query("SELECT checkout_id, ref FROM bookings");
  const body = JSON.stringify({ data: { id: "evt_1", attributes: { type: "checkout_session.payment.paid", livemode: false, data: { id: rows[0].checkout_id, attributes: { metadata: { booking_ref: rows[0].ref }, payments: [{ id: "pay_1" }] } } } } });
  const bad = await c.req("/webhooks/payments", { method: "POST", raw: body, headers: { "Content-Type": "application/json", "Paymongo-Signature": signPayload("wrong-secret", body) } });
  assert.equal(bad.status, 401);
  assert.equal((await status(b.data.token)).status, "pending");
  const sig = signPayload(process.env.PAYMENTS_WEBHOOK_SECRET, body);
  const ok = await c.req("/webhooks/payments", { method: "POST", raw: body, headers: { "Content-Type": "application/json", "Paymongo-Signature": sig } });
  assert.equal(ok.status, 200);
  const again = await c.req("/webhooks/payments", { method: "POST", raw: body, headers: { "Content-Type": "application/json", "Paymongo-Signature": sig } });
  assert.equal(again.data.result, "duplicate");
  const receipts = await H.query("SELECT count(*)::int AS n FROM outbox WHERE subject LIKE 'Booked:%'");
  assert.equal(receipts.rows[0].n, 1);
});

test("a class never takes more than 10 seats, even with simultaneous bookings", async () => {
  const cls = await H.addClass(120);
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) => c.post("/api/bookings", H.details(cls, i + 1))));
  assert.equal(results.filter((r) => r.status === 201).length, 10);
  assert.equal(results.filter((r) => r.status === 409).length, 4);
});

test("unpaid holds expire and free the seat; a late payment is refunded if the class filled", async () => {
  const cls = await H.addClass(120, null);
  await H.query("UPDATE classes SET capacity = 1 WHERE id = $1", [cls]);
  const first = await c.post("/api/bookings", H.details(cls, 1));
  H.clock.advance(61 * 60000);
  await runJobs();
  assert.equal((await status(first.data.token)).status, "expired");
  assert.equal((await c.get("/api/classes")).data.classes[0].seatsLeft, 1);
  await H.bookAndPay(c, cls, 2); // someone else takes the seat
  const pay = await c.req(new URL(first.data.checkoutUrl).pathname + "/pay", { method: "POST" });
  assert.equal(pay.status, 303);
  assert.equal((await status(first.data.token)).status, "refunded");
});

test("48-hour check cancels classes under 5 and offers a free move or refund", async () => {
  const small = await H.addClass(60), other = await H.addClass(200);
  const b = await H.bookAndPay(c, small, 1);
  for (let i = 2; i <= 3; i++) await H.bookAndPay(c, small, i);
  H.clock.advance(13 * H.HOUR); // now 47h before
  const report = await runJobs();
  assert.equal(report.cancelled, 1);
  const v = await status(b.token);
  assert.equal(v.freeMove, true);
  assert.equal(v.canRefund, true);
  const moved = await c.post(`/api/bookings/${b.token}/reschedule`, { classId: other });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.rescheduled, false, "a free move doesn't use up the reschedule");
  const notice = await H.query("SELECT count(*)::int AS n FROM outbox WHERE subject LIKE 'Your class won''t run%'");
  assert.equal(notice.rows[0].n, 3);
});

test("classes with 5 or more are confirmed, and links go out 24 hours before", async () => {
  const cls = await H.addClass(60);
  for (let i = 1; i <= 5; i++) await H.bookAndPay(c, cls, i);
  H.clock.advance(13 * H.HOUR);
  assert.equal((await runJobs()).confirmed, 1);
  H.clock.advance(24 * H.HOUR); // 23h before
  assert.equal((await runJobs()).links, 5);
  assert.equal((await runJobs()).links, 0, "links are sent once");
});

test("refunds close at 48 hours; reschedule is allowed once until 24 hours", async () => {
  const a = await H.addClass(100), b2 = await H.addClass(150), b3 = await H.addClass(170);
  const early = await H.bookAndPay(c, a, 1);
  assert.equal((await c.post(`/api/bookings/${early.token}/cancel`)).status, 200);
  assert.equal((await status(early.token)).status, "refunded");
  const late = await H.bookAndPay(c, a, 2);
  H.clock.advance(53 * H.HOUR); // 47h before class a
  assert.equal((await c.post(`/api/bookings/${late.token}/cancel`)).status, 409);
  assert.equal((await c.post(`/api/bookings/${late.token}/reschedule`, { classId: b2 })).status, 200);
  const again = await c.post(`/api/bookings/${late.token}/reschedule`, { classId: b3 });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /already used/);
});

test("attendance, required survey, certificate, and leader privacy", async () => {
  const marco = await H.addUser("marco@example.com", "Marco T.", "leader");
  await H.addUser("joy@example.com", "Joy R.", "leader");
  const cls = await H.addClass(60, marco);
  const bookings = [];
  for (let i = 1; i <= 5; i++) bookings.push(await H.bookAndPay(c, cls, i));
  const leader = H.client(srv.base);
  assert.equal((await leader.post("/api/login", { email: "marco@example.com", password: "password-123456" })).status, 200);
  const roster = (await leader.get("/api/leader/classes")).data.classes[0].roster;
  assert.equal(roster.length, 5);
  assert.equal(roster[0].email, undefined, "leaders don't see contact details");
  assert.equal((await leader.post("/api/leader/attendance", { bookingId: roster[0].id, status: "attended" })).status, 409, "not before class starts");
  H.clock.advance(60 * H.HOUR);
  const joy = H.client(srv.base);
  await joy.post("/api/login", { email: "joy@example.com", password: "password-123456" });
  assert.equal((await joy.post("/api/leader/attendance", { bookingId: roster[0].id, status: "attended" })).status, 404, "other leaders can't mark");
  for (const s of roster) assert.equal((await leader.post("/api/leader/attendance", { bookingId: s.id, status: "attended" })).status, 200);
  const t = bookings[0].token;
  assert.equal((await c.get(`/certificate/${t}`)).status, 404, "certificate locked until survey");
  const partial = await c.post(`/api/survey/${t}`, { q1: 5, q2: 5, q3: 5, q4: 5, q5: 5 });
  assert.equal(partial.status, 400);
  assert.match(partial.data.error, /question 6/);
  const ok = await c.post(`/api/survey/${t}`, { q1: 5, q2: 4, q3: 5, q4: 5, q5: 4, nps: 10, comment: "Great" });
  assert.equal(ok.data.done, true);
  assert.equal((await c.post(`/api/survey/${t}`, { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, nps: 0 })).status, 409);
  assert.equal((await c.get(`/certificate/${t}`)).status, 200);
  assert.equal((await leader.get("/api/leader/ratings")).data.enough, false, "ratings hidden under 3 responses");
  for (const b of bookings.slice(1, 3)) await c.post(`/api/survey/${b.token}`, { q1: 4, q2: 4, q3: 4, q4: 4, q5: 4, nps: 8 });
  const r = (await leader.get("/api/leader/ratings")).data;
  assert.equal(r.enough, true);
  assert.equal(r.overall, 4.3);
  H.clock.advance(25 * H.HOUR);
  assert.equal((await runJobs()).reminders, 2, "reminders only for students who haven't answered");
});

test("admin access, JSON-only writes, referral codes and dashboard data", async () => {
  await H.addUser("ann@example.com", "Ann", "owner");
  await H.addUser("marco@example.com", "Marco T.", "leader");
  assert.equal((await c.get("/api/admin/dashboard")).status, 401);
  const leader = H.client(srv.base);
  await leader.post("/api/login", { email: "marco@example.com", password: "password-123456" });
  assert.equal((await leader.get("/api/admin/dashboard")).status, 403);
  assert.equal((await leader.post("/api/password", { current: "wrong", next: "new-password-123" })).status, 401);
  assert.equal((await leader.post("/api/password", { current: "password-123456", next: "new-password-123" })).status, 200);
  assert.equal((await H.client(srv.base).post("/api/login", { email: "marco@example.com", password: "new-password-123" })).status, 200);
  const owner = H.client(srv.base);
  assert.equal((await owner.post("/api/login", { email: "ann@example.com", password: "wrong" })).status, 401);
  assert.equal((await owner.post("/api/login", { email: "ann@example.com", password: "password-123456" })).status, 200);
  const form = await owner.req("/api/admin/codes", { method: "POST", raw: "code=X", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(form.status, 415);
  assert.equal((await owner.post("/api/admin/codes", { code: "jen100", partner: "Jen" })).status, 201);
  const d = new Date(Date.now() + 5 * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  assert.equal((await owner.post("/api/admin/classes", { startsAt: `${d}T18:00`, zoomLink: "https://zoom.us/j/1" })).status, 201);
  const cls = (await owner.get("/api/admin/classes")).data.classes[0];
  assert.equal(new Date(cls.startsAt).getUTCHours(), 10, "18:00 Manila is 10:00 UTC");
  assert.equal((await c.post("/api/bookings", H.details(cls.id, 1, { referral: "nope1" }))).status, 400);
  const b = await H.bookAndPay(c, cls.id, 2, { referral: "jen100" });
  assert.equal((await c.get(`/api/bookings/${b.token}`)).data.referral, "JEN100");
  const dash = (await owner.get("/api/admin/dashboard")).data;
  assert.equal(dash.price, 799);
  assert.equal(dash.upcoming[0].taken, 1);
});

test("home page serves the live booking script, not the test-mode one", async () => {
  const home = await c.get("/");
  assert.equal(home.status, 200);
  assert.match(home.data, /\/book\.js/);
  assert.doesNotMatch(home.data, /src="app\.js"|dashboard\.js/);
  assert.equal((await c.get("/admin")).status, 200);
  assert.equal((await c.get("/styles.css")).status, 200);
});
