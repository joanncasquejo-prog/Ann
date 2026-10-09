/* Owner admin: dashboard, classes, leaders, referral codes, activity. */
(() => {
  const { api, esc, day, time } = BPO;
  const main = document.getElementById("main"), page = document.getElementById("page");
  const dashRoot = document.getElementById("dash-root"), tabs = document.getElementById("tabs");
  let tab = location.hash.slice(1) || "dashboard", dash = null, leaders = [], open = null, msg = null;

  async function start() {
    const { user } = await api("/api/me");
    if (!user || user.role !== "owner") {
      tabs.hidden = true; dashRoot.hidden = true; page.hidden = false;
      return BPOLogin(main, "Owner sign-in", start);
    }
    tabs.hidden = false;
    show(tab);
  }

  async function show(t) {
    tab = t; history.replaceState(null, "", "#" + t); msg = msg && msg.keep ? { ...msg, keep: false } : null;
    tabs.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    const isDash = t === "dashboard";
    dashRoot.hidden = !isDash; page.hidden = isDash;
    try {
      if (isDash) {
        if (!dash) { const cfg = await api("/api/config"); dash = BPODashboard.mount(dashRoot, () => api("/api/admin/dashboard"), { pill: cfg.testMode ? "Test mode · simulated payments" : "", eyebrow: "Owner dashboard" }); }
        return dash.refresh();
      }
      if (t === "classes") return classesView();
      if (t === "leaders") return leadersView();
      if (t === "codes") return codesView();
      if (t === "activity") return activityView();
    } catch (e) { if (e.status === 401) return start(); main.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
  }
  const banner = () => (msg ? `<div class="banner ${msg.kind}">${esc(msg.text)}</div>` : "");

  async function classesView() {
    const [{ classes }, l] = await Promise.all([api("/api/admin/classes"), api("/api/admin/leaders")]);
    leaders = l.leaders.filter((x) => x.active);
    const opts = (sel) => `<option value="">To be announced</option>` + leaders.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    const upcoming = classes.filter((c) => !c.past), past = classes.filter((c) => c.past).reverse();
    const row = (c) => `
      <tr>
        <td><strong>${day(c.startsAt)}</strong><span class="d-block muted">${time(c.startsAt)}</span></td>
        <td>${c.past ? esc(c.leader || "To be announced") : `<select data-leader="${c.id}" aria-label="Leader">${opts(c.leaderId)}</select>`}</td>
        <td class="n">${c.taken}/${c.capacity}</td>
        <td><span class="status-chip ${c.status === "cancelled" ? "" : "s-active"}">${c.status}</span></td>
        <td>${c.past ? (c.zoomLink ? "Set" : "—") : `<input class="admin-input" data-zoom="${c.id}" value="${esc(c.zoomLink || "")}" placeholder="https://zoom.us/j/…" aria-label="Class link">`}</td>
        <td class="admin-actions"><button class="link-btn" data-act="bookings" data-id="${c.id}">${open === c.id ? "Hide" : "Students"}</button>
          ${!c.past && c.status !== "cancelled" ? `<button class="link-btn danger" data-act="cancel" data-id="${c.id}">Cancel</button>` : ""}</td>
      </tr>
      ${open === c.id ? `<tr><td colspan="6" id="bk-${c.id}" class="admin-sub">Loading…</td></tr>` : ""}`;
    main.innerHTML = `${banner()}
      <h1 class="app-title">Classes</h1>
      <form id="f-class" class="panel admin-form" novalidate>
        <h2>Add a class</h2>
        <div class="admin-grid">
          <label for="c-start">Date and start time (Philippine time)<input id="c-start" name="startsAt" type="datetime-local" required></label>
          <label for="c-leader">BPO Experience Leader<select id="c-leader" name="leaderId">${opts(null)}</select></label>
          <label for="c-zoom">Class link (optional)<input id="c-zoom" name="zoomLink" placeholder="https://zoom.us/j/…"></label>
        </div>
        <p class="fine">Classes run 3 hours, take up to 10 students, and need 5 to run. Booking closes at the 48-hour check if fewer than 5 have booked.</p>
        <p class="form-error" id="c-error" role="alert"></p>
        <button class="btn btn-primary">Add class</button>
      </form>
      <section class="panel"><h2>Upcoming</h2><div class="d-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Leader</th><th class="n">Seats</th><th>Status</th><th>Class link</th><th></th></tr></thead><tbody>${upcoming.map(row).join("") || `<tr><td colspan="6" class="muted">No upcoming classes. Add one above.</td></tr>`}</tbody></table></div></section>
      <section class="panel"><h2>Last 2 weeks</h2><div class="d-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Leader</th><th class="n">Seats</th><th>Status</th><th>Class link</th><th></th></tr></thead><tbody>${past.map(row).join("") || `<tr><td colspan="6" class="muted">No recent classes.</td></tr>`}</tbody></table></div></section>`;
    main.querySelector("#f-class").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/api/admin/classes", Object.fromEntries(new FormData(e.target))); msg = { kind: "ok", text: "Class added. It's open for booking now.", keep: true }; show("classes"); }
      catch (err) { main.querySelector("#c-error").textContent = err.message; }
    });
    main.querySelectorAll("[data-leader]").forEach((s) => s.addEventListener("change", async () => { await api(`/api/admin/classes/${s.dataset.leader}`, { leaderId: s.value || null }, "PATCH"); msg = { kind: "ok", text: "Leader updated.", keep: true }; show("classes"); }));
    main.querySelectorAll("[data-zoom]").forEach((i) => i.addEventListener("change", async () => {
      try { await api(`/api/admin/classes/${i.dataset.zoom}`, { zoomLink: i.value }, "PATCH"); msg = { kind: "ok", text: "Class link saved.", keep: true }; }
      catch (err) { msg = { kind: "warn", text: err.message, keep: true }; }
      show("classes");
    }));
    if (open) {
      const { bookings } = await api(`/api/admin/classes/${open}/bookings`);
      const el = main.querySelector(`#bk-${open}`);
      if (el) el.innerHTML = bookings.length ? `<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Status</th><th>Code</th><th>Survey</th></tr></thead><tbody>${bookings.map((b) => `<tr><td>${esc(b.name)}<span class="d-block muted">${esc(b.ref)}</span></td><td>${esc(b.email)}</td><td>${esc(b.mobile)}</td><td>${esc(b.status)}</td><td>${esc(b.referral_code || "—")}</td><td>${b.survey ? "Done" : "—"}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No bookings yet.</p>`;
    }
  }

  async function leadersView() {
    const { leaders: list } = await api("/api/admin/leaders");
    main.innerHTML = `${banner()}
      <h1 class="app-title">BPO Experience Leaders</h1>
      <section class="panel"><div class="d-scroll"><table class="admin-table"><thead><tr><th>Name</th><th>Email (sign-in)</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.email)}</td><td>${l.active ? "Active" : "Inactive"}</td><td><button class="link-btn" data-act="leader-active" data-id="${l.id}" data-on="${l.active ? 0 : 1}">${l.active ? "Deactivate" : "Reactivate"}</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No leaders yet.</td></tr>`}
      </tbody></table></div></section>
      <form id="f-leader" class="panel admin-form" novalidate>
        <h2>Add a leader</h2>
        <div class="admin-grid">
          <label for="ld-name">Name<input id="ld-name" name="name" required></label>
          <label for="ld-email">Email<input id="ld-email" name="email" type="email" required></label>
          <label for="ld-pw">Temporary password<input id="ld-pw" name="password" type="text" minlength="10" required></label>
        </div>
        <p class="fine">Share the password with the leader privately. They sign in at /leader.</p>
        <p class="form-error" id="ld-error" role="alert"></p>
        <button class="btn btn-primary">Add leader</button>
      </form>`;
    main.querySelector("#f-leader").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/api/admin/leaders", Object.fromEntries(new FormData(e.target))); msg = { kind: "ok", text: "Leader added.", keep: true }; show("leaders"); }
      catch (err) { main.querySelector("#ld-error").textContent = err.message; }
    });
  }

  async function codesView() {
    const { codes } = await api("/api/admin/codes");
    main.innerHTML = `${banner()}
      <h1 class="app-title">Referral codes</h1>
      <p class="muted">₱100 commission per paid seat whose class ran and wasn't refunded.</p>
      <section class="panel"><div class="d-scroll"><table class="admin-table"><thead><tr><th>Code</th><th>Partner</th><th class="n">Counted seats</th><th class="n">Commission</th><th>Status</th><th></th></tr></thead><tbody>
        ${codes.map((c) => `<tr><td><span class="d-code">${esc(c.code)}</span></td><td>${esc(c.partner)}</td><td class="n">${c.counted}</td><td class="n">₱${(c.counted * 100).toLocaleString("en-PH")}</td><td>${c.active ? "Active" : "Inactive"}</td><td><button class="link-btn" data-act="code-active" data-id="${esc(c.code)}" data-on="${c.active ? 0 : 1}">${c.active ? "Deactivate" : "Reactivate"}</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No codes yet.</td></tr>`}
      </tbody></table></div></section>
      <form id="f-code" class="panel admin-form" novalidate>
        <h2>Add a code</h2>
        <div class="admin-grid">
          <label for="cd-code">Code<input id="cd-code" name="code" autocapitalize="characters" required></label>
          <label for="cd-partner">Who it belongs to<input id="cd-partner" name="partner" required></label>
        </div>
        <p class="form-error" id="cd-error" role="alert"></p>
        <button class="btn btn-primary">Add code</button>
      </form>`;
    main.querySelector("#f-code").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/api/admin/codes", Object.fromEntries(new FormData(e.target))); msg = { kind: "ok", text: "Code added.", keep: true }; show("codes"); }
      catch (err) { main.querySelector("#cd-error").textContent = err.message; }
    });
  }

  async function activityView() {
    const a = await api("/api/admin/activity");
    const ts = (t) => `${day(t)}, ${time(t)}`;
    main.innerHTML = `${banner()}
      <h1 class="app-title">Activity</h1>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="jobs">Run scheduled checks now</button></div>
      <p class="fine">Scheduled checks run every 5 minutes: unpaid holds, the 48-hour minimum, class links and survey reminders.</p>
      <section class="panel"><h2>Messages sent${a.testMode ? " (logged only in test mode)" : ""}</h2>
        <ul class="admin-log">${a.outbox.map((m) => `<li><span class="muted">${ts(m.created_at)} · ${m.channel} to ${esc(m.recipient)} · ${esc(m.status)}</span>${m.subject ? `<strong>${esc(m.subject)}</strong>` : ""}<pre>${esc(m.body)}</pre></li>`).join("") || `<li class="muted">No messages yet.</li>`}</ul></section>
      <section class="panel"><h2>Event log</h2>
        <ul class="admin-log">${a.events.map((e) => `<li><span class="muted">${ts(e.created_at)}</span>${esc(e.message)}</li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul></section>`;
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) return show(t.dataset.tab);
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const a = el.dataset.act;
    try {
      if (a === "logout") { await api("/api/logout", {}); dash = null; return start(); }
      if (a === "bookings") { open = open === Number(el.dataset.id) ? null : Number(el.dataset.id); return show("classes"); }
      if (a === "cancel") {
        if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Tap again to cancel class"; return; }
        const r = await api(`/api/admin/classes/${el.dataset.id}/cancel`, {}); msg = { kind: "ok", text: `Class cancelled. ${r.notified} student${r.notified === 1 ? " was" : "s were"} emailed to choose a refund or a free move.`, keep: true }; return show("classes");
      }
      if (a === "leader-active") { await api(`/api/admin/leaders/${el.dataset.id}`, { active: el.dataset.on === "1" }, "PATCH"); return show("leaders"); }
      if (a === "code-active") { await api(`/api/admin/codes/${encodeURIComponent(el.dataset.id)}`, { active: el.dataset.on === "1" }, "PATCH"); return show("codes"); }
      if (a === "jobs") { const r = await api("/api/admin/run-jobs", {}); msg = { kind: "ok", text: `Checks done: ${r.expired} holds released, ${r.confirmed} confirmed, ${r.cancelled} cancelled, ${r.links} links sent, ${r.reminders} reminders.`, keep: true }; return show("activity"); }
    } catch (err) { msg = { kind: "warn", text: err.message, keep: true }; show(tab); }
  });
  start();
})();
