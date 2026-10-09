/* BPO Readiness test-mode booking: class schedule with 10-seat limit,
   simulated checkout, reschedule/refund rules and a trainer roster.
   No real payment, SMS or email is sent. */
(() => {
  const HOUR = 3600000, DAY = 24 * HOUR;
  const PRICE = 599, SEATS = 10, MIN_RUN = 5;
  const STORE_KEY = "bpo-readiness-classes-test-v1";
  const SAMPLE_NAMES = ["Bea R.", "Carlo M.", "Denise T.", "Enzo P.", "Fritz L.", "Gwen S.", "Hannah D.", "Ivan C.", "Jas A.", "Kyla B."];

  /* Sample schedule, built relative to the day the test starts so it never goes stale. */
  function sampleClasses(base) {
    // Manila is UTC+8 with no daylight saving, so its midnight is fixed relative to UTC.
    const PH = 8 * HOUR;
    const midnight = Math.floor((base + PH) / DAY) * DAY - PH;
    const dow = new Date(midnight + PH).getUTCDay();
    const at = (days, h) => midnight + days * DAY + h * HOUR;
    const lead = 3; // first class at least 3 days out
    const nextDow = (target) => lead + ((target - (dow + lead) % 7 + 7) % 7);
    const sat = nextDow(6), wed = nextDow(3), sun = nextDow(0);
    return [
      { id: "c1", start: at(wed, 18), taken: 7 },
      { id: "c2", start: at(sat, 9), taken: 10 },
      { id: "c3", start: at(sat, 13), taken: 3 },
      { id: "c4", start: at(sun + 7, 9), taken: 0 },
    ].sort((a, b) => a.start - b.start).map((c) => ({ ...c, trainer: "BPO trainer (to be announced)", cancelled: false }));
  }

  const fresh = () => {
    const t0 = Date.now();
    return { t0, offsetH: 0, step: "schedule", classes: sampleClasses(t0), pick: null, buyer: null, booking: null, inbox: [], log: [], notice: null };
  };
  let S = load() || fresh();
  let rosterFor = null;

  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

  const now = () => Date.now() + S.offsetH * HOUR;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TZ = { timeZone: "Asia/Manila" };
  const fmtDay = (t) => new Date(t).toLocaleDateString("en-PH", { ...TZ, weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (t) => new Date(t).toLocaleTimeString("en-PH", { ...TZ, hour: "numeric", minute: "2-digit" });
  const fmtWhen = (t) => `${fmtDay(t)} · ${fmtTime(t)}–${fmtTime(t + 3 * HOUR)}`;
  const maskMobile = (m) => m.replace(/^(\+63)(\d)(\d{2})(\d{3})(\d{4})$/, "$1 $2•• ••• $5");
  const cls = (id) => S.classes.find((c) => c.id === id);
  const mine = (c) => S.booking && S.booking.classId === c.id && ["pending", "paid"].includes(S.booking.status) ? 1 : 0;
  const seatsTaken = (c) => c.taken + mine(c);
  const seatsLeft = (c) => SEATS - seatsTaken(c);
  const hoursUntil = (c) => (c.start - now()) / HOUR;

  function log(msg) { S.log.unshift(msg); S.log = S.log.slice(0, 30); }
  function sms(text) { S.inbox.unshift({ kind: "SMS", to: maskMobile(S.buyer.mobile), text }); }
  function email(text) { S.inbox.unshift({ kind: "Email", to: S.buyer.email, text }); }

  /* ---------- shell ---------- */
  const root = document.getElementById("app");
  const parts = [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer")];
  function openApp() { parts.forEach((p) => (p.hidden = true)); root.hidden = false; window.scrollTo(0, 0); render(); }
  function closeApp() {
    root.hidden = true; parts.forEach((p) => (p.hidden = false));
    if (location.hash === "#app") history.replaceState(null, "", location.pathname);
  }
  document.querySelectorAll("[data-open-app]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); openApp(); }));
  if (location.hash === "#app") openApp();

  function render() {
    tick();
    save();
    const main = rosterFor ? renderRoster()
      : S.step === "details" ? renderDetails()
      : S.step === "pay" ? renderPay()
      : S.step === "gateway" ? renderGateway()
      : S.step === "booking" ? renderBooking()
      : S.step === "reschedule" ? renderSchedule(true)
      : renderSchedule(false);
    root.innerHTML = `
      <div class="app-bar"><div class="container app-bar-inner">
        <button class="brand link-btn" data-act="home"><span class="brand-mark">B</span> BPO Readiness</button>
        <span class="test-pill">Test mode · no real payments</span>
      </div></div>
      <div class="container app-grid">
        <div class="app-main">${S.notice ? `<div class="banner ${S.notice.kind}">${esc(S.notice.text)}<button class="link-btn" data-act="dismiss">Dismiss</button></div>` : ""}${progress()}${main}</div>
        <aside class="test-panel">${renderPanel()}</aside>
      </div>`;
    bind();
  }

  /* Time-based rules: OTC holds expire, the 48-hour minimum class size check, class reminders. */
  function tick() {
    const b = S.booking;
    if (b && b.status === "pending" && now() > b.holdUntil) {
      b.status = "expired";
      log(`OTC payment for ${b.ref} not confirmed within 24 hours. Seat released.`);
      S.notice = { kind: "warn", text: "Your seat hold expired because the over-the-counter payment wasn't confirmed in 24 hours." };
    }
    S.classes.forEach((c) => {
      if (c.checked || c.cancelled || hoursUntil(c) > 48) return;
      c.checked = true;
      if (seatsTaken(c) >= MIN_RUN) { log(`Class on ${fmtDay(c.start)} confirmed with ${seatsTaken(c)} students.`); return; }
      c.cancelled = true;
      log(`Class on ${fmtDay(c.start)} had ${seatsTaken(c)} students 48 hours before start (minimum ${MIN_RUN}). Class cancelled.`);
      if (b && b.classId === c.id && b.status === "paid") {
        email(`Your class on ${fmtWhen(c.start)} didn't reach ${MIN_RUN} students, so it won't run. Choose a full refund or a free move to another class.`);
        S.notice = { kind: "warn", text: "Your class didn't reach the minimum of 5 students. Choose a full refund or a free move." };
      }
    });
    if (!b) return;
    const c = cls(b.classId);
    if (b.status === "paid" && !c.cancelled && hoursUntil(c) <= 24 && !b.linkSent) {
      b.linkSent = true;
      email(`Your class is tomorrow, ${fmtWhen(c.start)}. Your personal Zoom link: zoom.us/j/test-${b.ref}. Don't share it; only booked names are admitted.`);
      sms(`BPO Readiness: your class starts ${fmtWhen(c.start)}. Zoom link sent to your email.`);
      log(`Class reminder and personal Zoom link sent for ${b.ref}.`);
    }
  }

  function progress() {
    if (rosterFor || !["schedule", "details", "pay", "gateway"].includes(S.step) || (S.booking && S.step === "schedule" && ["paid", "pending"].includes(S.booking.status))) return "";
    const steps = ["Choose a class", "Your details", "Pay"];
    const idx = { schedule: 0, details: 1, pay: 2, gateway: 2 }[S.step];
    return `<ol class="progress">${steps.map((s, i) => `<li class="${i < idx ? "done" : i === idx ? "current" : ""}"><span>${i + 1}</span>${s}</li>`).join("")}</ol>`;
  }

  /* ---------- schedule ---------- */
  function renderSchedule(rescheduling) {
    const active = S.booking && ["paid", "pending"].includes(S.booking.status);
    if (active && !rescheduling) return renderBooking();
    const list = S.classes.filter((c) => c.start > now() && !c.cancelled && (!rescheduling || c.id !== S.booking.classId));
    return `
      ${rescheduling ? `<button class="link-btn" data-act="back-booking">← Back to my booking</button>` : ""}
      <h1 class="app-title">${rescheduling ? "Pick a new class" : "Upcoming classes"}</h1>
      <p class="muted">${rescheduling ? "Your one free reschedule. Your seat moves to the class you pick." : "Each class is 3 hours on Zoom, with a maximum of 10 students. Times are Philippine time."}</p>
      <p class="fine">Sample schedule for testing.</p>
      <ul class="class-list">
        ${list.map((c) => {
          const left = seatsLeft(c), full = left <= 0;
          return `<li class="class-card ${full ? "full" : ""}">
            <div class="class-when"><strong>${fmtDay(c.start)}</strong><span>${fmtTime(c.start)}–${fmtTime(c.start + 3 * HOUR)}</span></div>
            <div class="class-info"><span class="muted">${esc(c.trainer)}</span>
              <span class="seat-meter" aria-label="${seatsTaken(c)} of ${SEATS} seats taken">${Array.from({ length: SEATS }, (_, i) => `<i class="${i < seatsTaken(c) ? "on" : ""}"></i>`).join("")}</span>
              <span class="seats-left ${left <= 2 && !full ? "low" : ""}">${full ? "Full" : `${left} seat${left === 1 ? "" : "s"} left`}</span></div>
            <button class="btn ${full ? "btn-ghost" : "btn-primary"} btn-sm" data-act="${rescheduling ? "do-reschedule" : "pick"}" data-id="${c.id}" ${full ? "disabled" : ""}>${full ? "Full" : rescheduling ? "Move here" : "Book · ₱599"}</button>
          </li>`;
        }).join("") || `<li class="muted">No upcoming classes right now.</li>`}
      </ul>`;
  }

  /* ---------- details ---------- */
  function renderDetails() {
    const c = cls(S.pick), b = S.buyer || {};
    return `
      <button class="link-btn" data-act="back-schedule">← Change class</button>
      <h1 class="app-title">Your details</h1>
      <div class="summary"><div><strong>${fmtWhen(c.start)}</strong><p class="muted">3-hour live class · ${seatsLeft(c)} seats left</p></div><div class="summary-price">₱${PRICE}</div></div>
      <form id="f-details" class="form" novalidate>
        <label for="d-name">Full name (as it will appear in class)<input id="d-name" name="name" autocomplete="name" value="${esc(b.name)}" required></label>
        <label for="d-email">Email<input id="d-email" name="email" type="email" autocomplete="email" value="${esc(b.email)}" required><small>Your receipt and Zoom link go here.</small></label>
        <label for="d-mobile">PH mobile number<input id="d-mobile" name="mobile" inputmode="tel" placeholder="0917 123 4567" required><small>For class reminders.</small></label>
        <label class="check" for="d-terms"><input id="d-terms" type="checkbox" name="terms"> I agree to the <a href="terms.html" target="_blank">Terms of Service</a>, including that this seat is for me only.</label>
        <label class="check" for="d-privacy"><input id="d-privacy" type="checkbox" name="privacy"> I have read the <a href="privacy.html" target="_blank">Privacy Notice</a>.</label>
        <p class="form-error" id="d-error" role="alert"></p>
        <button class="btn btn-primary">Continue to payment</button>
      </form>`;
  }
  function submitDetails(f) {
    const d = Object.fromEntries(new FormData(f));
    const err = (m) => { f.querySelector("#d-error").textContent = m; };
    const m = (d.mobile || "").replace(/[\s-]/g, "").match(/^(?:\+?63|0)(9\d{9})$/);
    if (!d.name.trim()) return err("Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return err("Enter a valid email address.");
    if (!m) return err("Enter a PH mobile number like 0917 123 4567.");
    if (!d.terms) return err("Tick the Terms of Service box to continue.");
    if (!d.privacy) return err("Tick the Privacy Notice box to continue.");
    S.buyer = { name: d.name.trim(), email: d.email.trim(), mobile: "+63" + m[1] };
    S.step = "pay";
    render();
  }

  /* ---------- pay ---------- */
  function renderPay() {
    const c = cls(S.pick);
    const methods = [["gcash", "GCash"], ["maya", "Maya"], ["card", "Debit / credit card"], ["otc", "Over the counter (7-Eleven, Cebuana)"]];
    return `
      <button class="link-btn" data-act="back-details">← Edit details</button>
      <h1 class="app-title">Checkout</h1>
      <div class="summary"><div><strong>BPO Readiness Live Class</strong><p class="muted">${fmtWhen(c.start)} · seat for ${esc(S.buyer.name)}</p></div><div class="summary-price">₱${PRICE}</div></div>
      <form id="f-pay" class="form">
        <fieldset class="methods"><legend>Payment method</legend>
          ${methods.map(([v, l], i) => `<label class="method" for="pm-${v}"><input id="pm-${v}" type="radio" name="method" value="${v}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}
        </fieldset>
        <ul class="terms-list">
          <li>One seat for ${esc(S.buyer.name)} only.</li>
          <li>Full refund if you cancel at least 48 hours before class. One free reschedule up to 24 hours before.</li>
          <li>No-shows aren't refunded. Over-the-counter payments hold your seat for 24 hours.</li>
        </ul>
        <button class="btn btn-primary">Pay ₱${PRICE}</button>
      </form>`;
  }
  function submitPay(f) {
    const c = cls(S.pick);
    if (seatsLeft(c) <= 0) { S.notice = { kind: "warn", text: "That class just filled up. Pick another class." }; S.step = "schedule"; return render(); }
    S.order = { ref: "BR-" + Math.random().toString(36).slice(2, 8).toUpperCase(), method: new FormData(f).get("method"), status: "awaiting" };
    log(`Order ${S.order.ref} created (${S.order.method.toUpperCase()}). Sent to the payment gateway.`);
    S.step = "gateway";
    render();
  }

  /* ---------- simulated gateway ---------- */
  function renderGateway() {
    const o = S.order;
    const label = { gcash: "GCash", maya: "Maya", card: "Card", otc: "Over the counter" }[o.method];
    if (o.status === "failed") return `
      <h1 class="app-title">Payment didn't go through</h1>
      <p class="muted">Order ${o.ref} was ${o.reason}. You weren't charged and no seat was booked.</p>
      <button class="btn btn-primary" data-act="retry-pay">Try again</button>`;
    return `
      <div class="gateway">
        <p class="eyebrow">Test payment gateway</p>
        <h2>${label} · ₱${PRICE}.00</h2>
        <p class="muted">Order ${o.ref} · Merchant: BPO Readiness</p>
        <p>This screen stands in for the real gateway. Choose what happens:</p>
        <div class="btn-row">
          ${o.method === "otc"
            ? `<button class="btn btn-primary" data-act="gw-slip">Generate payment slip</button>`
            : `<button class="btn btn-primary" data-act="gw-paid">Approve payment</button><button class="btn btn-ghost" data-act="gw-decline">Decline payment</button>`}
          <button class="btn btn-ghost" data-act="gw-redirect">Return to site without paying</button>
        </div>
      </div>`;
  }
  function createBooking(status) {
    S.booking = { ref: S.order.ref, classId: S.pick, status, method: S.order.method, rescheduled: false, created: now(), holdUntil: now() + DAY };
    S.step = "booking";
  }
  function confirmPaid() {
    const b = S.booking;
    b.status = "paid"; b.paidAt = now();
    const c = cls(b.classId);
    log(`Webhook payment.paid received. Signature verified. ${b.ref} confirmed: seat ${seatsTaken(c)} of ${SEATS}.`);
    email(`Official receipt ${b.ref}: BPO Readiness Live Class, ${fmtWhen(c.start)}, ₱${PRICE}.00 paid by ${b.method.toUpperCase()}.`);
    sms(`BPO Readiness: you're booked for ${fmtWhen(c.start)}. Ref ${b.ref}. Zoom link arrives 24h before class.`);
    S.notice = { kind: "ok", text: "Payment confirmed. Your seat is booked." };
  }

  /* ---------- my booking ---------- */
  function renderBooking() {
    const b = S.booking;
    if (!b) { S.step = "schedule"; return renderSchedule(false); }
    const c = cls(b.classId);
    const h = hoursUntil(c);
    const label = { pending: "Awaiting payment", paid: "Booked", cancelled: "Cancelled", refunded: "Refunded", expired: "Hold expired", attended: "Attended", noshow: "No-show" }[b.status];
    const live = b.status === "paid" && !c.cancelled;
    const canCancelRefund = live && h >= 48;
    const canReschedule = live && h >= 24 && !b.rescheduled;
    const inClass = live && h <= 0 && h > -3;
    return `
      <div class="dash-head">
        <div><p class="eyebrow">My booking · ${b.ref}</p><h1 class="app-title">${fmtDay(c.start)}</h1><p class="muted">${fmtTime(c.start)}–${fmtTime(c.start + 3 * HOUR)} · ${esc(c.trainer)}</p></div>
        <span class="status-chip ${["paid", "attended"].includes(b.status) ? "s-active" : ""}">${c.cancelled && b.status === "paid" ? "Class cancelled" : label}</span>
      </div>
      ${b.status === "pending" ? `
        <div class="panel">
          <h2>Pay at 7-Eleven or Cebuana</h2>
          <p>Reference <strong class="mono">${b.ref}</strong> · ₱${PRICE}.00</p>
          <p class="muted">Your seat is held until ${fmtDay(b.holdUntil)}, ${fmtTime(b.holdUntil)}. If payment isn't confirmed by then, the seat goes back on sale.</p>
          <button class="btn btn-primary" data-act="otc-confirm">Test: branch confirms payment</button>
        </div>` : ""}
      ${live && c.cancelled === false ? `
        <ul class="kv panel-kv">
          <li><span>Student</span><span>${esc(S.buyer.name)}</span></li>
          <li><span>Seats filled</span><span>${seatsTaken(c)} of ${SEATS}</span></li>
          <li><span>Zoom link</span><span>${b.linkSent ? "Sent to your email" : "Emailed 24 hours before class"}</span></li>
          <li><span>Reschedule</span><span>${b.rescheduled ? "Used" : h >= 24 ? "1 free, until 24h before" : "Closed"}</span></li>
          <li><span>Refund</span><span>${h >= 48 ? "Full refund until 48h before" : "Not available"}</span></li>
        </ul>` : ""}
      ${inClass ? `<div class="banner ok">Class is happening now. Join with the link in your email. The waiting room closes 15 minutes after the start.</div>` : ""}
      ${b.status === "paid" && c.cancelled ? `
        <div class="panel">
          <h2>This class won't run</h2>
          <p class="muted">It didn't reach the minimum of ${MIN_RUN} students. Choose what you'd like:</p>
          <div class="btn-row"><button class="btn btn-primary" data-act="free-move">Move to another class</button><button class="btn btn-ghost" data-act="refund">Full refund</button></div>
        </div>` : ""}
      ${b.status === "noshow" ? `<p class="muted">You missed the class without rescheduling, so the seat was forfeited with no refund.</p>` : ""}
      ${b.status === "attended" ? `<p class="muted">Thanks for joining. Book another class any time.</p>` : ""}
      <div class="btn-row">
        ${canReschedule ? `<button class="btn btn-primary" data-act="reschedule">Reschedule (free, once)</button>` : ""}
        ${canCancelRefund ? `<button class="btn btn-ghost" data-act="cancel-refund">Cancel and get a full refund</button>` : ""}
        ${["cancelled", "refunded", "expired", "attended", "noshow"].includes(b.status) ? `<button class="btn btn-primary" data-act="new-booking">Book another class</button>` : ""}
      </div>
      ${live && !c.cancelled && !canCancelRefund ? `<p class="fine">Cancellations with a refund close 48 hours before class.</p>` : ""}`;
  }

  /* ---------- trainer roster ---------- */
  function renderRoster() {
    const c = cls(rosterFor);
    const names = SAMPLE_NAMES.slice(0, c.taken).map((n) => ({ name: n, note: "Paid" }));
    if (mine(c)) names.push({ name: S.buyer.name, note: S.booking.status === "pending" ? "Awaiting OTC payment" : "Paid", you: true });
    return `
      <button class="link-btn" data-act="close-roster">← Back</button>
      <p class="eyebrow">Trainer view</p>
      <h1 class="app-title">Class roster</h1>
      <p class="muted">${fmtWhen(c.start)} · ${names.length} of ${SEATS} seats${c.cancelled ? " · cancelled" : ""}</p>
      <ul class="roster">${names.map((n) => `<li><span>${esc(n.name)}${n.you ? " (you)" : ""}</span><span class="muted">${n.note}</span></li>`).join("") || `<li class="muted">No students yet.</li>`}</ul>
      ${mine(c) && S.booking.status === "paid" && hoursUntil(c) <= 0 ? `
        <div class="btn-row"><button class="btn btn-primary" data-act="mark-attended">Mark you as attended</button><button class="btn btn-ghost" data-act="mark-noshow">Mark you as no-show</button></div>` : ""}
      <p class="fine">In the live version, the trainer uses this list to admit only booked names from the Zoom waiting room.</p>`;
  }

  /* ---------- test panel ---------- */
  function renderPanel() {
    const b = S.booking;
    const c = b && cls(b.classId);
    return `
      <div class="tp-block">
        <h3>Test inbox</h3>
        ${S.inbox.length ? `<ul class="inbox">${S.inbox.slice(0, 5).map((m) => `<li><span class="tp-meta">${m.kind} · ${esc(m.to)}</span><span>${esc(m.text)}</span></li>`).join("")}</ul>` : `<p class="muted small">Receipts, reminders and Zoom links show up here.</p>`}
      </div>
      <div class="tp-block">
        <h3>Test controls</h3>
        <p class="muted small">Test time: ${fmtDay(now())}, ${fmtTime(now())}</p>
        <div class="tp-btns">
          <button class="btn btn-ghost btn-sm" data-act="t-day">Skip ahead 1 day</button>
          ${c && ["paid", "pending"].includes(b.status) && hoursUntil(c) > 0 ? `
            ${hoursUntil(c) > 49 ? `<button class="btn btn-ghost btn-sm" data-act="t-49">Jump to 49h before class</button>` : ""}
            ${hoursUntil(c) > 47 ? `<button class="btn btn-ghost btn-sm" data-act="t-47">Jump to 47h before class</button>` : ""}
            ${hoursUntil(c) > 23 ? `<button class="btn btn-ghost btn-sm" data-act="t-23">Jump to 23h before class</button>` : ""}
            <button class="btn btn-ghost btn-sm" data-act="t-start">Jump to class start</button>` : ""}
        </div>
      </div>
      <div class="tp-block">
        <h3>Trainer view</h3>
        <ul class="roster-links">${S.classes.filter((x) => x.start > now() - 3 * HOUR).map((x) => `<li><button class="link-btn" data-act="roster" data-id="${x.id}">${fmtDay(x.start)}, ${fmtTime(x.start)}</button><span class="muted">${seatsTaken(x)}/${SEATS}${x.cancelled ? " · cancelled" : ""}</span></li>`).join("")}</ul>
      </div>
      <div class="tp-block">
        <h3>Event log</h3>
        ${S.log.length ? `<ul class="evlog">${S.log.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p class="muted small">Nothing yet.</p>`}
      </div>
      <button class="link-btn danger" data-act="reset">Reset test</button>`;
  }

  /* ---------- events ---------- */
  function bind() {
    const on = (id, fn) => { const f = document.getElementById(id); if (f) f.addEventListener("submit", (e) => { e.preventDefault(); fn(f); }); };
    on("f-details", submitDetails);
    on("f-pay", submitPay);
    const mob = document.getElementById("d-mobile");
    if (mob && S.buyer) mob.value = "0" + S.buyer.mobile.slice(3);
  }
  const jumpTo = (hBefore) => { const c = cls(S.booking.classId); S.offsetH += hoursUntil(c) - hBefore; };
  const actions = {
    home: () => { rosterFor = null; closeApp(); },
    dismiss: () => { S.notice = null; },
    pick: (el) => { S.pick = el.dataset.id; S.step = "details"; S.notice = null; },
    "back-schedule": () => { S.step = "schedule"; },
    "back-details": () => { S.step = "details"; },
    "back-booking": () => { S.step = "booking"; },
    "retry-pay": () => { S.step = "pay"; },
    "gw-paid": () => { createBooking("paid"); confirmPaid(); },
    "gw-decline": () => { S.order.status = "failed"; S.order.reason = "declined"; log(`Webhook payment.failed for ${S.order.ref}. No seat booked.`); },
    "gw-redirect": () => { S.order.status = "failed"; S.order.reason = "not confirmed by the gateway"; log(`Browser returned for ${S.order.ref}, but no webhook arrived. No seat booked.`); },
    "gw-slip": () => { createBooking("pending"); log(`OTC slip issued for ${S.booking.ref}. Seat held for 24 hours.`); email(`Pay ₱${PRICE}.00 at 7-Eleven or Cebuana with reference ${S.booking.ref} within 24 hours to keep your seat.`); },
    "otc-confirm": () => { confirmPaid(); },
    reschedule: () => { S.step = "reschedule"; },
    "free-move": () => { S.step = "reschedule"; S.booking.freeMove = true; },
    "do-reschedule": (el) => {
      const b = S.booking, from = cls(b.classId), to = cls(el.dataset.id);
      if (seatsLeft(to) <= 0) return;
      b.classId = to.id; b.linkSent = false;
      if (!b.freeMove) b.rescheduled = true;
      b.freeMove = false;
      log(`${b.ref} moved from ${fmtDay(from.start)} to ${fmtDay(to.start)}.`);
      email(`Your seat moved to ${fmtWhen(to.start)}. Ref ${b.ref}.`);
      S.notice = { kind: "ok", text: `Moved to ${fmtWhen(to.start)}.` };
      S.step = "booking";
    },
    "cancel-refund": () => { S.booking.status = "refunded"; log(`${S.booking.ref} cancelled more than 48h before class. Full refund issued.`); email(`Your booking ${S.booking.ref} was cancelled. ₱${PRICE}.00 is being refunded.`); S.notice = { kind: "ok", text: "Booking cancelled. Your full refund is on its way." }; },
    refund: () => { S.booking.status = "refunded"; log(`${S.booking.ref} refunded because the class was cancelled.`); email(`Refund of ₱${PRICE}.00 for ${S.booking.ref} is on its way.`); S.notice = { kind: "ok", text: "Full refund issued." }; },
    "new-booking": () => { S.booking = null; S.step = "schedule"; S.notice = null; },
    roster: (el) => { rosterFor = el.dataset.id; },
    "close-roster": () => { rosterFor = null; },
    "mark-attended": () => { S.booking.status = "attended"; log(`Trainer marked ${S.buyer.name} as attended.`); rosterFor = null; S.step = "booking"; },
    "mark-noshow": () => { S.booking.status = "noshow"; log(`Trainer marked ${S.buyer.name} as a no-show. Seat forfeited, no refund.`); rosterFor = null; S.step = "booking"; },
    "t-day": () => { S.offsetH += 24; log("Test: 1 day passed."); },
    "t-49": () => { jumpTo(49); log("Test: jumped to 49 hours before class."); },
    "t-47": () => { jumpTo(47); log("Test: jumped to 47 hours before class."); },
    "t-23": () => { jumpTo(23); log("Test: jumped to 23 hours before class."); },
    "t-start": () => { jumpTo(0); log("Test: class is starting."); },
    reset: () => { S = fresh(); rosterFor = null; log("Test reset."); },
  };
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    e.preventDefault();
    const fn = actions[el.dataset.act];
    if (!fn) return;
    fn(el);
    if (!root.hidden) render();
  });
})();
