/* Manage a booking: payment status, refund, reschedule, survey link. */
(() => {
  const main = document.getElementById("main");
  const token = location.pathname.split("/").pop();
  const params = new URLSearchParams(location.search);
  const { api, esc, day, time } = BPO;
  let b = null, classes = null, msg = null, polls = 0;

  async function load() {
    try { b = await api(`/api/bookings/${encodeURIComponent(token)}`); }
    catch (e) { main.innerHTML = `<h1 class="app-title">Booking not found</h1><p class="muted">${esc(e.message)}</p><a class="btn btn-primary" href="/#app">Book a class</a>`; return; }
    render();
    if (b.status === "pending" && !params.has("cancelled") && polls < 20) { polls++; setTimeout(load, 3000); }
  }

  function render() {
    const label = { pending: "Awaiting payment", paid: "Booked", expired: "Hold expired", failed: "Payment not started", refunded: "Refunded", attended: "Attended", noshow: "No-show" }[b.status];
    const good = ["paid", "attended"].includes(b.status) && b.classStatus !== "cancelled";
    const h = (new Date(b.startsAt) - Date.now()) / 3600000;
    main.innerHTML = `
      ${msg ? `<div class="banner ${msg.kind}">${esc(msg.text)}</div>` : ""}
      <div class="dash-head">
        <div><p class="eyebrow">My booking · ${esc(b.ref)}</p><h1 class="app-title">${day(b.startsAt)}</h1>
        <p class="muted">${time(b.startsAt)}–${time(new Date(b.startsAt).getTime() + 3 * 3600000)} · ${esc(b.leader)}</p></div>
        <span class="status-chip ${good ? "s-active" : ""}">${b.classStatus === "cancelled" && b.status === "paid" ? "Class cancelled" : label}</span>
      </div>
      ${b.status === "pending" ? (params.has("cancelled")
        ? `<div class="panel"><h2>Payment not completed</h2><p class="muted">Your seat is held until ${time(b.holdUntil)}. Try again before then to keep it.</p><button class="btn btn-primary" data-act="retry">Try payment again</button></div>`
        : `<div class="panel"><h2>Confirming your payment…</h2><p class="muted">This page updates when the payment gateway confirms. It usually takes a few seconds.</p></div>`) : ""}
      ${b.status === "expired" ? `<div class="panel"><h2>Your seat hold ended</h2><p class="muted">The payment wasn't completed in time, so the seat went back on sale. If you were charged, we'll refund you automatically.</p><a class="btn btn-primary" href="/#app">Book again</a></div>` : ""}
      ${b.status === "paid" && b.classStatus !== "cancelled" ? `
        <ul class="kv panel-kv">
          <li><span>Student</span><span>${esc(b.name)}</span></li>
          <li><span>Amount paid</span><span>₱${b.amount}.00</span></li>
          ${b.referral ? `<li><span>Referral code</span><span>${esc(b.referral)}</span></li>` : ""}
          <li><span>Class link</span><span>${b.linkSent ? "Sent to your email" : "Emailed 24 hours before class"}</span></li>
          <li><span>Reschedule</span><span>${b.rescheduled ? "Used" : h >= 24 ? "1 free, until 24h before" : "Closed"}</span></li>
          <li><span>Refund</span><span>${b.canRefund ? "Full refund until 48h before" : "Not available"}</span></li>
        </ul>` : ""}
      ${b.freeMove ? `<div class="panel"><h2>This class won't run</h2><p class="muted">It didn't reach the minimum number of students. Choose a free move or a full refund.</p></div>` : ""}
      ${b.status === "attended" ? (b.surveyDone
        ? `<div class="panel"><h2>Thanks for joining</h2><p class="muted">Your class notes and certificate are ready.</p><div class="btn-row"><a class="btn btn-primary" href="/survey/${encodeURIComponent(token)}">Notes and certificate</a></div></div>`
        : `<div class="panel"><h2>One step left: your class survey</h2><p class="muted">It's required and takes about 2 minutes. It unlocks your class notes and certificate of attendance.</p><a class="btn btn-primary" href="/survey/${encodeURIComponent(token)}">Take the survey</a></div>`) : ""}
      ${b.status === "noshow" ? `<p class="muted">You missed the class without rescheduling, so the seat was forfeited with no refund.</p>` : ""}
      ${b.status === "refunded" ? `<div class="panel"><h2>Refunded</h2><p class="muted">₱${b.amount}.00 is on its way back. It can take a few business days to show.</p><a class="btn btn-primary" href="/#app">Book another class</a></div>` : ""}
      ${classes ? picker() : `<div class="btn-row">
        ${b.canReschedule ? `<button class="btn btn-primary" data-act="show-classes">${b.freeMove ? "Move to another class (free)" : "Reschedule (free, once)"}</button>` : ""}
        ${b.canRefund ? `<button class="btn btn-ghost" data-act="refund">Cancel and get a full refund</button>` : ""}
      </div>`}`;
  }

  function picker() {
    const list = classes.filter((c) => c.seatsLeft > 0 && c.id !== b.classId);
    return `<div class="panel"><h2>Pick a new class</h2>
      <ul class="class-list">${list.map((c) => `<li class="class-card"><div class="class-when"><strong>${day(c.startsAt)}</strong><span>${time(c.startsAt)}</span></div><div class="class-info"><span class="muted">${esc(c.leader)}</span><span class="seats-left">${c.seatsLeft} seats left</span></div><button class="btn btn-primary btn-sm" data-act="move" data-id="${c.id}">Move here</button></li>`).join("") || `<li class="muted">No other classes are open right now.</li>`}</ul>
      <button class="link-btn" data-act="hide-classes">Cancel</button></div>`;
  }

  main.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const a = el.dataset.act;
    try {
      if (a === "retry") { const r = await api(`/api/bookings/${encodeURIComponent(token)}/retry`, {}); location.href = r.checkoutUrl; return; }
      if (a === "show-classes") { classes = (await api("/api/classes")).classes; }
      if (a === "hide-classes") classes = null;
      if (a === "move") { b = await api(`/api/bookings/${encodeURIComponent(token)}/reschedule`, { classId: Number(el.dataset.id) }); classes = null; msg = { kind: "ok", text: "Your seat has moved. We've emailed the details." }; }
      if (a === "refund") {
        if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Tap again to confirm the refund"; return; }
        b = await api(`/api/bookings/${encodeURIComponent(token)}/cancel`, {}); msg = { kind: "ok", text: "Booking cancelled. Your full refund is on its way." };
      }
    } catch (err) { msg = { kind: "warn", text: err.message }; }
    render();
  });
  load();
})();
