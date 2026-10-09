/* Leader portal: own classes, roster names, attendance, combined ratings. */
(() => {
  const { api, esc, day, time } = BPO;
  const main = document.getElementById("main"), tabs = document.getElementById("tabs");
  let msg = null;

  async function start() {
    const { user } = await api("/api/me");
    if (!user || !["leader", "owner"].includes(user.role)) { tabs.hidden = true; return BPOLogin(main, "Leader sign-in", start); }
    tabs.hidden = false;
    document.getElementById("who").textContent = user.name;
    tabs.querySelectorAll("[data-tab]").forEach((b) => (b.hidden = true));
    render();
  }

  async function render() {
    let classes, ratings;
    try { [{ classes }, ratings] = await Promise.all([api("/api/leader/classes"), api("/api/leader/ratings")]); }
    catch (e) { if (e.status === 401) return start(); main.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; return; }
    const r1 = (v) => Number(v).toFixed(1);
    main.innerHTML = `
      ${msg ? `<div class="banner ${msg.kind}">${esc(msg.text)}</div>` : ""}
      <h1 class="app-title">My classes</h1>
      <section class="panel"><h2>My ratings</h2>
        ${ratings.enough ? `<ul class="kv"><li><span>Overall</span><span>${r1(ratings.overall)} / 5</span></li><li><span>Explained clearly</span><span>${r1(ratings.clear)}</span></li><li><span>Mock-call feedback</span><span>${r1(ratings.feedback)}</span></li><li><span>Everyone got to speak</span><span>${r1(ratings.everyoneSpoke)}</span></li><li><span>Students feel more ready</span><span>${r1(ratings.moreReady)}</span></li><li><span>Would recommend (NPS)</span><span>${ratings.nps > 0 ? "+" : ""}${ratings.nps}</span></li></ul><p class="fine">Combined from ${ratings.responses} surveys. Target: 4.5 overall.</p>`
          : `<p class="muted">Ratings appear after at least 3 students have answered (${ratings.responses} so far), so no single student can be identified.</p>`}
      </section>
      <details class="panel"><summary>Change my password</summary>
        <form id="f-pw" class="form" novalidate>
          <label for="pw-cur">Current password<input id="pw-cur" name="current" type="password" autocomplete="current-password"></label>
          <label for="pw-new">New password (at least 10 characters)<input id="pw-new" name="next" type="password" autocomplete="new-password"></label>
          <button class="btn btn-primary btn-sm">Save new password</button>
        </form>
      </details>
      ${classes.map((c) => `
        <section class="panel">
          <div class="panel-head"><h2>${day(c.startsAt)} · ${time(c.startsAt)}</h2><span class="status-chip ${c.status === "cancelled" ? "" : "s-active"}">${c.status}</span></div>
          <p class="muted">${c.roster.length} of 10 students${c.zoomLink ? ` · <a href="${esc(c.zoomLink)}" target="_blank" rel="noopener">Class link</a>` : " · class link not set yet"}</p>
          <ul class="roster">${c.roster.map((s) => `<li><span>${esc(s.name)}</span><span class="roster-actions">${c.started && c.status !== "cancelled"
            ? `<button class="btn btn-sm ${s.status === "attended" ? "btn-primary" : "btn-ghost"}" data-mark="attended" data-id="${s.id}">Attended</button><button class="btn btn-sm ${s.status === "noshow" ? "btn-primary" : "btn-ghost"}" data-mark="noshow" data-id="${s.id}">No-show</button>`
            : `<span class="muted">${s.status === "paid" ? "Booked" : esc(s.status)}</span>`}</span></li>`).join("") || `<li class="muted">No students yet.</li>`}</ul>
          ${c.started ? `<p class="fine">Admit only these names from the waiting room. Marking someone attended sends their required survey.</p>` : ""}
        </section>`).join("") || `<p class="muted">No classes assigned to you in the last week or upcoming.</p>`}`;
  }

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "f-pw") return;
    e.preventDefault();
    try { await api("/api/password", Object.fromEntries(new FormData(e.target))); msg = { kind: "ok", text: "Password changed." }; }
    catch (err) { msg = { kind: "warn", text: err.message }; }
    render();
  });
  document.addEventListener("click", async (e) => {
    if (e.target.closest('[data-act="logout"]')) { await api("/api/logout", {}); return start(); }
    const b = e.target.closest("[data-mark]");
    if (!b) return;
    try { await api("/api/leader/attendance", { bookingId: Number(b.dataset.id), status: b.dataset.mark }); msg = { kind: "ok", text: "Attendance saved." }; }
    catch (err) { msg = { kind: "warn", text: err.message }; }
    render();
  });
  start();
})();
