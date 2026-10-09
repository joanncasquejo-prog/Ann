/* Live booking flow on the home page: pick a class, enter details, pay at the gateway. */
(() => {
  const root = document.getElementById("app");
  const parts = [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer")];
  let state = { step: "schedule", classes: [], pick: null, price: 799, error: "", busy: false, form: {} };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = (t) => new Date(t).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });
  const time = (t) => new Date(t).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
  const when = (t) => `${day(t)} · ${time(t)}–${time(new Date(t).getTime() + 3 * 3600000)}`;

  async function api(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  async function open() {
    parts.forEach((p) => (p.hidden = true)); root.hidden = false; window.scrollTo(0, 0);
    state.step = "schedule"; state.error = ""; render(true);
    try {
      const [cfg, cl] = await Promise.all([api("/api/config"), api("/api/classes")]);
      state.price = cfg.price; state.testMode = cfg.testMode; state.classes = cl.classes;
    } catch (e) { state.error = e.message; }
    render();
  }
  function close() { root.hidden = true; parts.forEach((p) => (p.hidden = false)); if (location.hash === "#app") history.replaceState(null, "", location.pathname); }
  document.querySelectorAll("[data-open-app]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); open(); }));
  if (location.hash === "#app") open();

  function render(loading) {
    const main = loading ? `<p class="muted">Loading classes…</p>` : state.step === "details" ? details() : schedule();
    root.innerHTML = `
      <div class="app-bar"><div class="container app-bar-inner">
        <button class="brand link-btn" data-act="home"><span class="brand-mark">B</span> BPO Readiness</button>
        ${state.testMode ? `<span class="test-pill">Test mode · no real payments</span>` : ""}
      </div></div>
      <div class="container app-single"><div class="app-main">
        <ol class="progress">${["Choose a class", "Your details", "Pay"].map((s, i) => { const idx = state.step === "details" ? 1 : 0; return `<li class="${i < idx ? "done" : i === idx ? "current" : ""}"><span>${i + 1}</span>${s}</li>`; }).join("")}</ol>
        ${state.error && state.step === "schedule" ? `<div class="banner warn">${esc(state.error)}</div>` : ""}
        ${main}
      </div></div>`;
    const f = root.querySelector("#f-details");
    if (f) f.addEventListener("submit", submit);
  }

  function schedule() {
    return `
      <h1 class="app-title">Upcoming classes</h1>
      <p class="muted">Each class is 3 hours on Zoom, with a maximum of 10 students. Times are Philippine time.</p>
      <ul class="class-list">${state.classes.map((c) => {
        const full = c.seatsLeft <= 0, taken = c.capacity - c.seatsLeft;
        return `<li class="class-card ${full ? "full" : ""}">
          <div class="class-when"><strong>${day(c.startsAt)}</strong><span>${time(c.startsAt)}–${time(new Date(c.startsAt).getTime() + 3 * 3600000)}</span></div>
          <div class="class-info"><span class="muted">${esc(c.leader)}</span>
            <span class="seat-meter" aria-label="${taken} of ${c.capacity} seats taken">${Array.from({ length: c.capacity }, (_, i) => `<i class="${i < taken ? "on" : ""}"></i>`).join("")}</span>
            <span class="seats-left ${c.seatsLeft <= 2 && !full ? "low" : ""}">${full ? "Full" : `${c.seatsLeft} seat${c.seatsLeft === 1 ? "" : "s"} left`}</span></div>
          <button class="btn ${full ? "btn-ghost" : "btn-primary"} btn-sm" data-act="pick" data-id="${c.id}" ${full ? "disabled" : ""}>${full ? "Full" : `Book · ₱${state.price}`}</button>
        </li>`;
      }).join("") || `<li class="muted">No classes are open for booking right now. Check back soon.</li>`}</ul>`;
  }

  function details() {
    const c = state.classes.find((x) => x.id === state.pick), v = state.form;
    return `
      <button class="link-btn" data-act="back">← Change class</button>
      <h1 class="app-title">Your details</h1>
      <div class="summary"><div><strong>${when(c.startsAt)}</strong><p class="muted">3-hour live class · ${esc(c.leader)}</p></div><div class="summary-price">₱${state.price}</div></div>
      <form id="f-details" class="form" novalidate>
        <label for="d-name">Full name (as it will appear in class)<input id="d-name" name="name" autocomplete="name" value="${esc(v.name)}" required></label>
        <label for="d-email">Email<input id="d-email" name="email" type="email" autocomplete="email" value="${esc(v.email)}" required><small>Your receipt and class link go here.</small></label>
        <label for="d-mobile">PH mobile number<input id="d-mobile" name="mobile" inputmode="tel" placeholder="0917 123 4567" value="${esc(v.mobile)}" required><small>For class reminders.</small></label>
        <label for="d-ref">Referral code (optional)<input id="d-ref" name="referral" autocapitalize="characters" value="${esc(v.referral)}"></label>
        <label class="check" for="d-terms"><input id="d-terms" type="checkbox" name="acceptTerms" ${v.acceptTerms ? "checked" : ""}> I agree to the <a href="/terms.html" target="_blank">Terms of Service</a>, including that this seat is for me only.</label>
        <label class="check" for="d-privacy"><input id="d-privacy" type="checkbox" name="acceptPrivacy" ${v.acceptPrivacy ? "checked" : ""}> I have read the <a href="/privacy.html" target="_blank">Privacy Notice</a>.</label>
        <ul class="terms-list">
          <li>Full refund if you cancel at least 48 hours before class. One free reschedule up to 24 hours before.</li>
          <li>No-shows aren't refunded. Your seat is held for 60 minutes while you pay.</li>
        </ul>
        <p class="form-error" id="d-error" role="alert">${esc(state.error)}</p>
        <button class="btn btn-primary" ${state.busy ? "disabled" : ""}>${state.busy ? "Opening payment…" : `Continue to payment · ₱${state.price}`}</button>
      </form>`;
  }

  async function submit(e) {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    state.form = { name: fd.get("name"), email: fd.get("email"), mobile: fd.get("mobile"), referral: fd.get("referral"), acceptTerms: fd.get("acceptTerms") === "on", acceptPrivacy: fd.get("acceptPrivacy") === "on" };
    state.busy = true; state.error = ""; render();
    try {
      const r = await api("/api/bookings", { classId: state.pick, ...state.form });
      location.href = r.checkoutUrl;
    } catch (err) {
      state.busy = false; state.error = err.message;
      if (/no longer open|filled up/.test(err.message)) { state.step = "schedule"; state.classes = (await api("/api/classes").catch(() => ({ classes: state.classes }))).classes; }
      render();
    }
  }

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    e.preventDefault();
    const a = el.dataset.act;
    if (a === "home") close();
    if (a === "pick") { state.pick = Number(el.dataset.id); state.step = "details"; state.error = ""; render(); }
    if (a === "back") { state.step = "schedule"; state.error = ""; render(); }
  });
})();
