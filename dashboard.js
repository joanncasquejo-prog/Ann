/* BPO Readiness owner dashboard (test mode). Combines a seeded sample of the
   last 4 weeks with the bookings and surveys made in the test booking app. */
(() => {
  const HOUR = 3600000, DAY = 24 * HOUR;
  const PRICE = 799, SEATS = 10, MIN_RUN = 5, COMMISSION = 100, FIXED_MONTH = 3500, FEE = 0.03;
  const VAT_LIMIT = 3000000, TARGET_FILL = 8, TARGET_RATING = 4.5;
  const LEADERS = [
    { id: "L1", name: "Marco T.", quality: 0.9 },
    { id: "L2", name: "Joy R.", quality: 0.75 },
    { id: "L3", name: "Pia L.", quality: 0.45 },
  ];
  const CODES = ["JEN100", "KAYE100", "TIKTOKBPO"];
  const FIRST = ["Bea", "Carlo", "Denise", "Enzo", "Fritz", "Gwen", "Hannah", "Ivan", "Jas", "Kyla", "Lance", "Mika", "Nico", "Olive", "Paolo", "Rica", "Sam", "Tin", "Uly", "Vince"];
  const COMMENTS = [
    "The mock call was the most useful part. I finally know how to handle an angry customer.",
    "More time for the final interview questions please.",
    "Very clear explanations, I liked the introduction template.",
    "Some students talked too long during hour 2.",
    "I wish the class was recorded so I could review it.",
    "Feedback on my pronunciation was really specific. Thank you!",
    "The leader rushed the last part.",
    "Worth it. I'm recommending this to my cousin.",
    "Breakout rooms were confusing at first.",
  ];
  const TZ = { timeZone: "Asia/Manila" };
  const fmtDay = (t) => new Date(t).toLocaleDateString("en-PH", { ...TZ, weekday: "short", month: "short", day: "numeric" });
  const fmtShort = (t) => new Date(t).toLocaleDateString("en-PH", { ...TZ, month: "short", day: "numeric" });
  const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
  const pct = (n) => (isFinite(n) ? Math.round(n * 100) : 0) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const r1 = (n) => (isFinite(n) ? n.toFixed(1) : "–");
  const round1 = (n) => Math.round(n * 10) / 10;

  let leaderRate = 250;
  let showTable = false;

  /* ---------- data ---------- */
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function sampleData(now) {
    const rand = rng(20261009);
    const PH = 8 * HOUR;
    const today = Math.floor((now + PH) / DAY) * DAY - PH;
    const classes = [], bookings = [];
    let n = 0;
    for (let d = 28; d >= 1; d--) {
      const day = today - d * DAY;
      const dow = new Date(day + PH).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const leader = LEADERS[n % 3]; n++;
      const start = day + 18 * HOUR;
      const demand = 0.55 + 0.35 * leader.quality + rand() * 0.25;
      const slow = rand() < 0.12;
      const taken = slow ? 3 + Math.floor(rand() * 2) : Math.max(5, Math.min(SEATS, Math.round(demand * SEATS + (rand() - 0.5) * 3)));
      const c = { id: "s" + n, start, leader: leader.name, taken, cancelled: taken < MIN_RUN, sample: true };
      classes.push(c);
      for (let i = 0; i < taken; i++) bookings.push(makeBooking(rand, c, leader.quality, now));
      if (rand() < 0.35) bookings.push({ classId: c.id, name: pick(rand, FIRST), status: "refunded", referral: rand() < 0.5 ? pick(rand, CODES) : null, sample: true });
    }
    return { classes, bookings };
  }
  function pick(rand, a) { return a[Math.floor(rand() * a.length)]; }
  function makeBooking(rand, c, quality, now) {
    const b = { classId: c.id, name: pick(rand, FIRST) + " " + String.fromCharCode(65 + Math.floor(rand() * 26)) + ".", referral: rand() < 0.55 ? pick(rand, CODES) : null, sample: true };
    if (c.cancelled) { b.status = rand() < 0.6 ? "refunded" : "moved"; return b; }
    b.status = rand() < 0.07 ? "noshow" : "attended";
    if (b.status === "attended") {
      b.attendedAt = Math.min(c.start + 3 * HOUR, now);
      const hoursSince = (now - b.attendedAt) / HOUR;
      const done = hoursSince > 72 ? rand() < 0.97 : rand() < 0.55;
      if (done) {
        const base = 3 + quality * 2;
        const q = () => Math.max(1, Math.min(5, Math.round(base + (rand() - 0.55) * 1.6)));
        const nps = Math.max(0, Math.min(10, Math.round(5 + quality * 5 + (rand() - 0.5) * 4)));
        b.survey = { at: b.attendedAt + rand() * 40 * HOUR, q1: q(), q2: q(), q3: q(), q4: q(), q5: q(), nps, comment: rand() < 0.3 ? pick(rand, COMMENTS) : "" };
      }
    }
    return b;
  }

  function liveData(S, now) {
    const classes = [], bookings = [];
    const mine = [...(S.history || []), ...(S.booking ? [{ ...S.booking, name: S.buyer?.name }] : [])];
    const rand = rng(7);
    for (const c of S.classes) {
      if (c.start > now) continue;
      const lc = { id: "live-" + c.id, start: c.start, leader: "To be announced", taken: c.taken, cancelled: c.cancelled, live: true };
      const own = mine.filter((b) => b.classId === c.id && ["attended", "noshow", "paid"].includes(b.status));
      lc.taken += own.length;
      classes.push(lc);
      for (let i = 0; i < c.taken; i++) bookings.push(makeBooking(rand, lc, 0.7, now));
      own.forEach((b) => bookings.push({ classId: lc.id, name: (b.name || "You") + " (your test)", status: b.status === "paid" ? "attended" : b.status, referral: b.referral, attendedAt: b.attendedAt, survey: b.survey, you: true }));
    }
    mine.filter((b) => b.status === "refunded").forEach((b) => bookings.push({ classId: "live-" + b.classId, name: (b.name || "You") + " (your test)", status: "refunded", referral: b.referral, you: true }));
    return { classes, bookings };
  }

  function collect() {
    const S = window.bpoReadinessState?.();
    const now = S ? Date.now() + S.offsetH * HOUR : Date.now();
    const a = sampleData(now), b = S ? liveData(S, now) : { classes: [], bookings: [] };
    const upcoming = S ? S.classes.filter((c) => c.start > now).map((c) => {
      const own = S.booking && S.booking.classId === c.id && ["paid", "pending"].includes(S.booking.status) ? 1 : 0;
      return { ...c, taken: c.taken + own };
    }) : [];
    return { now, classes: [...a.classes, ...b.classes].sort((x, y) => x.start - y.start), bookings: [...a.bookings, ...b.bookings], upcoming };
  }

  /* ---------- metrics ---------- */
  function metrics(D) {
    const byClass = new Map(D.classes.map((c) => [c.id, c]));
    const ran = D.classes.filter((c) => !c.cancelled);
    const paidSeats = D.bookings.filter((b) => ["attended", "noshow"].includes(b.status));
    const attended = D.bookings.filter((b) => b.status === "attended");
    const noshow = D.bookings.filter((b) => b.status === "noshow");
    const refunded = D.bookings.filter((b) => b.status === "refunded");
    const surveys = attended.filter((b) => b.survey).map((b) => ({ ...b.survey, leader: byClass.get(b.classId).leader, name: b.name, you: b.you }));
    const unanswered = attended.filter((b) => !b.survey).map((b) => ({ name: b.name, leader: byClass.get(b.classId).leader, hours: Math.max(0, (D.now - b.attendedAt) / HOUR), you: b.you }));
    const pending = unanswered.filter((p) => p.hours <= 7 * 24);
    const lapsed = unanswered.length - pending.length;
    const npsOf = (list) => list.length ? Math.round(100 * (list.filter((s) => s.nps >= 9).length - list.filter((s) => s.nps <= 6).length) / list.length) : NaN;
    const days = 28, months = days / 30;
    const gross = paidSeats.length * PRICE;
    const fees = gross * FEE;
    const codeSeats = paidSeats.filter((b) => b.referral);
    const marketing = codeSeats.length * COMMISSION;
    const leaderPay = paidSeats.length * leaderRate;
    const fixed = FIXED_MONTH * months;
    const pre = gross - fees - marketing - leaderPay - fixed;
    const tax = Math.max(0, gross - (250000 / 12) * months) * 0.08;
    const leaders = [...new Set(D.classes.map((c) => c.leader))].map((name) => {
      const cs = ran.filter((c) => c.leader === name);
      const sv = surveys.filter((s) => s.leader === name);
      const seats = paidSeats.filter((b) => byClass.get(b.classId).leader === name);
      return {
        name, classes: cs.length, cancelled: D.classes.filter((c) => c.leader === name && c.cancelled).length,
        avgStudents: avg(cs.map((c) => c.taken)), responses: sv.length,
        q1: avg(sv.map((s) => s.q1)), q2: avg(sv.map((s) => s.q2)), q3: avg(sv.map((s) => s.q3)), q4: avg(sv.map((s) => s.q4)), q5: avg(sv.map((s) => s.q5)),
        nps: npsOf(sv), payout: seats.length * leaderRate,
      };
    });
    const codes = [...CODES, ...new Set(codeSeats.map((b) => b.referral).filter((c) => !CODES.includes(c)))].map((code) => {
      const seats = codeSeats.filter((b) => b.referral === code).length;
      return { code, seats, owed: seats * COMMISSION };
    }).filter((c) => c.seats).sort((a, b) => b.seats - a.seats);
    return {
      lapsed, ran, cancelled: D.classes.filter((c) => c.cancelled), paidSeats, attended, noshow, refunded, surveys, pending,
      avgFill: avg(ran.map((c) => c.taken)), noshowRate: noshow.length / paidSeats.length,
      refundRate: refunded.length / (paidSeats.length + refunded.length),
      nps: npsOf(surveys), promoters: surveys.filter((s) => s.nps >= 9).length, passives: surveys.filter((s) => s.nps >= 7 && s.nps <= 8).length, detractors: surveys.filter((s) => s.nps <= 6).length,
      rating: avg(surveys.map((s) => s.q1)), completion: surveys.length / attended.length,
      gross, fees, marketing, leaderPay, fixed, pre, tax, keep: pre - tax, codeShare: codeSeats.length / paidSeats.length,
      annualGross: gross * (365 / days), leaders, codes, codeSeats: codeSeats.length, noCode: paidSeats.length - codeSeats.length,
    };
  }

  /* ---------- render ---------- */
  const root = document.getElementById("dash");
  const parts = () => [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer"), document.getElementById("app")];
  function open() { parts().forEach((p) => p && (p.hidden = true)); root.hidden = false; window.scrollTo(0, 0); render(); }
  function close() {
    root.hidden = true;
    [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer")].forEach((p) => (p.hidden = false));
    if (location.hash === "#dashboard") history.replaceState(null, "", location.pathname);
  }
  window.bpoOpenDashboard = open;
  document.querySelectorAll("[data-open-dash]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); open(); }));

  function status(level, text) { return `<span class="d-status d-${level}"><span aria-hidden="true">${level === "good" ? "✓" : level === "warn" ? "!" : "✕"}</span>${text}</span>`; }

  function render() {
    const D = collect(), M = metrics(D);
    const first = D.classes[0]?.start, last = D.now;
    const alerts = [];
    M.leaders.filter((l) => l.responses >= 3 && round1(l.q1) < TARGET_RATING).forEach((l) => alerts.push(["crit", `${l.name}'s leader rating is ${r1(l.q1)}, below the ${TARGET_RATING} target. Review their classes and comments.`]));
    const late = M.pending.filter((p) => p.hours > 48);
    if (late.length) alerts.push(["warn", `${late.length} required survey${late.length > 1 ? "s are" : " is"} more than 48 hours overdue.`]);
    D.upcoming.filter((c) => !c.cancelled && (c.start - D.now) / HOUR < 96 && c.taken < MIN_RUN).forEach((c) => alerts.push(["warn", `${fmtDay(c.start)} class has ${c.taken} of ${SEATS} students and will be cancelled at the 48-hour check unless it reaches ${MIN_RUN}.`]));
    if (M.annualGross > VAT_LIMIT * 0.8) alerts.push(["warn", `Yearly sales are on track for ${peso(M.annualGross)}, close to the ₱3M VAT threshold. Talk to your accountant.`]);
    if (M.avgFill < TARGET_FILL) alerts.push(["warn", `Classes average ${r1(M.avgFill)} students, below the target of ${TARGET_FILL}.`]);

    root.innerHTML = `
      <div class="d-bar"><div class="d-wrap d-bar-in">
        <button class="d-back" data-d="close">← Website</button>
        <span class="d-pill">Test mode · sample data + your test bookings</span>
      </div></div>
      <div class="d-wrap d-main">
        <header class="d-head">
          <div><p class="d-eyebrow">Owner dashboard</p><h1>BPO Readiness</h1>
          <p class="d-sub">Last 4 weeks · ${first ? fmtShort(first) : ""}–${fmtShort(last)} · ₱${PRICE} per seat</p></div>
          <label class="d-select" for="d-rate">Leader pay
            <select id="d-rate"><option value="250" ${leaderRate === 250 ? "selected" : ""}>₱250 per student</option><option value="350" ${leaderRate === 350 ? "selected" : ""}>₱350 per student</option></select>
          </label>
        </header>

        ${alerts.length ? `<section class="d-alerts" aria-label="Needs attention">${alerts.map(([l, t]) => `<div class="d-alert d-${l}"><span class="d-dot" aria-hidden="true">${l === "crit" ? "✕" : "!"}</span><p>${esc(t)}</p></div>`).join("")}</section>` : `<section class="d-alerts"><div class="d-alert d-good"><span class="d-dot">✓</span><p>Nothing needs attention right now.</p></div></section>`}

        <section class="d-tiles">
          ${tile("You keep (after tax)", peso(M.keep), `${peso(M.gross)} in sales`, "hero")}
          ${tile("Students per class", r1(M.avgFill), `target ${TARGET_FILL} of ${SEATS}`, M.avgFill >= TARGET_FILL ? "good" : "warn")}
          ${tile("Would recommend (NPS)", isFinite(M.nps) ? (M.nps > 0 ? "+" : "") + M.nps : "–", `${M.surveys.length} survey responses`, M.nps >= 50 ? "good" : M.nps >= 0 ? "warn" : "crit")}
          ${tile("Leader rating", r1(M.rating) + " / 5", `target ${TARGET_RATING}`, round1(M.rating) >= TARGET_RATING ? "good" : "warn")}
          ${tile("Survey completion", pct(M.completion), `${M.pending.length} pending${M.lapsed ? ` · ${M.lapsed} no response` : ""}`, M.completion >= 0.9 ? "good" : "warn")}
          ${tile("Classes run", String(M.ran.length), `${M.cancelled.length} cancelled under ${MIN_RUN}`, M.cancelled.length ? "warn" : "good")}
          ${tile("No-show rate", pct(M.noshowRate), `${M.noshow.length} of ${M.paidSeats.length} paid seats`, M.noshowRate <= 0.08 ? "good" : "warn")}
          ${tile("Refund rate", pct(M.refundRate), `${M.refunded.length} refunds`, M.refundRate <= 0.1 ? "good" : "warn")}
        </section>

        <section class="d-card">
          <div class="d-card-head"><div><h2>Students per class</h2><p class="d-sub">Target ${TARGET_FILL}, minimum ${MIN_RUN} to run. Hover a bar for details.</p></div>
          <button class="d-link" data-d="table">${showTable ? "Show chart" : "Show as table"}</button></div>
          ${showTable ? fillTable(D) : fillChart(D)}
        </section>

        <div class="d-grid2">
          <section class="d-card">
            <h2>Money, last 4 weeks</h2>
            <dl class="d-pl">
              <div><dt>Sales (${M.paidSeats.length} paid seats × ₱${PRICE})</dt><dd>${peso(M.gross)}</dd></div>
              <div><dt>Gateway fees (~3%)</dt><dd>−${peso(M.fees)}</dd></div>
              <div><dt>Leaders (₱${leaderRate} × ${M.paidSeats.length})</dt><dd>−${peso(M.leaderPay)}</dd></div>
              <div><dt>Marketing (₱${COMMISSION} × ${M.codeSeats} code seats)</dt><dd>−${peso(M.marketing)}</dd></div>
              <div><dt>Fixed costs</dt><dd>−${peso(M.fixed)}</dd></div>
              <div class="d-sum"><dt>Profit before tax</dt><dd>${peso(M.pre)}</dd></div>
              <div><dt>Income tax (8% option, estimate)</dt><dd>−${peso(M.tax)}</dd></div>
              <div class="d-total"><dt>You keep</dt><dd>${peso(M.keep)}</dd></div>
            </dl>
            <div class="d-meter-wrap">
              <div class="d-meter-label"><span>Yearly sales pace vs ₱3M VAT threshold</span><span>${peso(M.annualGross)}</span></div>
              <div class="d-meter" role="img" aria-label="${pct(M.annualGross / VAT_LIMIT)} of the VAT threshold"><span style="width:${Math.min(100, (M.annualGross / VAT_LIMIT) * 100)}%"></span></div>
            </div>
          </section>

          <section class="d-card">
            <h2>Marketing codes</h2>
            <p class="d-sub">${pct(M.codeShare)} of paid seats came through a referral code. Commission counts only for seats that were paid, not refunded, and whose class ran.</p>
            <table class="d-table">
              <thead><tr><th>Code</th><th class="n">Paid seats</th><th class="n">Commission owed</th></tr></thead>
              <tbody>${M.codes.map((c) => `<tr><td><span class="d-code">${esc(c.code)}</span></td><td class="n">${c.seats}</td><td class="n">${peso(c.owed)}</td></tr>`).join("")}
                <tr class="d-muted-row"><td>No code</td><td class="n">${M.noCode}</td><td class="n">₱0</td></tr></tbody>
              <tfoot><tr><td>Total</td><td class="n">${M.paidSeats.length}</td><td class="n">${peso(M.marketing)}</td></tr></tfoot>
            </table>
          </section>
        </div>

        <section class="d-card">
          <h2>BPO Experience Leaders</h2>
          <p class="d-sub">Averages from required post-class surveys (1–5). Leaders see only these combined results.</p>
          <div class="d-scroll"><table class="d-table">
            <thead><tr><th>Leader</th><th class="n">Classes</th><th class="n">Students / class</th><th class="n">Overall</th><th class="n">Clear</th><th class="n">Mock-call feedback</th><th class="n">Everyone spoke</th><th class="n">More ready</th><th class="n">NPS</th><th class="n">Payout owed</th><th>Status</th></tr></thead>
            <tbody>${M.leaders.map((l) => `<tr>
              <td><strong>${esc(l.name)}</strong><span class="d-sub d-block">${l.responses} responses${l.cancelled ? ` · ${l.cancelled} cancelled` : ""}</span></td>
              <td class="n">${l.classes}</td><td class="n">${r1(l.avgStudents)}</td>
              <td class="n"><strong>${r1(l.q1)}</strong></td><td class="n">${r1(l.q2)}</td><td class="n">${r1(l.q3)}</td><td class="n">${r1(l.q4)}</td><td class="n">${r1(l.q5)}</td>
              <td class="n">${isFinite(l.nps) ? (l.nps > 0 ? "+" : "") + l.nps : "–"}</td><td class="n">${peso(l.payout)}</td>
              <td>${l.responses < 3 ? status("warn", "Too few responses") : round1(l.q1) >= TARGET_RATING ? status("good", "On target") : round1(l.q1) >= 4 ? status("warn", "Watch") : status("crit", "Below target")}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </section>

        <div class="d-grid2">
          <section class="d-card">
            <h2>Would they recommend us?</h2>
            <p class="d-sub">"How likely are you to recommend BPO Readiness to a friend or family member?" (0–10)</p>
            <div class="d-nps">
              <div class="d-nps-big"><span>${isFinite(M.nps) ? (M.nps > 0 ? "+" : "") + M.nps : "–"}</span><small>NPS</small></div>
              <ul class="d-nps-list">
                <li><span class="d-swatch d-sw-good"></span><span>Promoters (9–10)</span><strong>${M.promoters}</strong><em>${pct(M.promoters / M.surveys.length)}</em></li>
                <li><span class="d-swatch d-sw-mid"></span><span>Passives (7–8)</span><strong>${M.passives}</strong><em>${pct(M.passives / M.surveys.length)}</em></li>
                <li><span class="d-swatch d-sw-crit"></span><span>Detractors (0–6)</span><strong>${M.detractors}</strong><em>${pct(M.detractors / M.surveys.length)}</em></li>
              </ul>
            </div>
            <p class="d-sub">NPS = % promoters − % detractors. Above +50 is excellent.</p>
            <h3>Latest comments</h3>
            <ul class="d-comments">${M.surveys.filter((s) => s.comment).sort((a, b) => b.at - a.at).slice(0, 5).map((s) => `<li><p>"${esc(s.comment)}"</p><span>${esc(s.leader)} · rated ${s.q1}/5 · recommend ${s.nps}/10${s.you ? " · your test" : ""}</span></li>`).join("") || `<li class="d-sub">No comments yet.</li>`}</ul>
          </section>

          <section class="d-card">
            <h2>Surveys pending</h2>
            <p class="d-sub">Required after every class. Reminders go out at 24 and 48 hours; notes and certificate unlock on submit.${M.lapsed ? ` ${M.lapsed} student${M.lapsed > 1 ? "s" : ""} never answered after 7 days.` : ""}</p>
            <ul class="d-pending">${M.pending.sort((a, b) => b.hours - a.hours).map((p) => `<li><span>${esc(p.name)}</span><span class="d-sub">${esc(p.leader)}</span>${p.hours > 48 ? status("crit", Math.round(p.hours) + "h overdue") : status("warn", Math.round(p.hours) + "h since class")}</li>`).join("") || `<li>${status("good", "All surveys in")}</li>`}</ul>

            <h2 class="d-mt">Upcoming classes</h2>
            <ul class="d-upcoming">${D.upcoming.map((c) => {
              const h = (c.start - D.now) / HOUR;
              return `<li><span>${fmtDay(c.start)}</span><span class="d-seats"><span class="d-mini"><i style="width:${(c.taken / SEATS) * 100}%"></i></span>${c.taken}/${SEATS}</span>${c.cancelled ? status("crit", "Cancelled") : c.taken >= MIN_RUN ? status("good", c.taken >= SEATS ? "Full" : "Will run") : status("warn", h < 48 ? "Under minimum" : `Needs ${MIN_RUN - c.taken} more`)}</li>`;
            }).join("") || `<li class="d-sub">No upcoming classes.</li>`}</ul>
          </section>
        </div>

        <p class="d-foot">Sample data for 3 example leaders and 3 example referral codes, plus anything you do in the test booking app. In the live version this reads from the booking system.</p>
      </div>`;
    bindChart();
  }

  function tile(label, value, sub, tone) {
    return `<div class="d-tile ${tone === "hero" ? "d-tile-hero" : ""}"><span class="d-tile-label">${label}</span><span class="d-tile-value">${value}</span><span class="d-tile-sub">${tone && tone !== "hero" ? `<i class="d-tick d-${tone}" aria-hidden="true"></i>` : ""}${sub}</span></div>`;
  }

  function fillChart(D) {
    const W = 760, H = 240, padL = 28, padR = 72, padT = 12, padB = 30;
    const cs = D.classes, n = cs.length || 1;
    const bw = (W - padL - padR) / n;
    const y = (v) => padT + (H - padT - padB) * (1 - v / SEATS);
    const ticks = [0, 5, 8, 10];
    return `<div class="d-chart"><div class="d-scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Students per class, last 4 weeks">
      ${[0, 10].map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="d-grid"/>`).join("")}
      ${ticks.map((t) => `<text x="${padL - 6}" y="${y(t) + 4}" class="d-axis" text-anchor="end">${t}</text>`).join("")}
      ${cs.map((c, i) => {
        const w = Math.max(3, Math.min(18, bw * 0.55)), x = padL + i * bw + (bw - w) / 2, top = y(c.taken);
        const r = Math.min(4, w / 2);
        const path = `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y(0)} Z`;
        return `<g class="d-bar-g" data-i="${i}" data-tip="${esc(`${fmtDay(c.start)} · ${c.leader} · ${c.taken} of ${SEATS} students${c.cancelled ? " · cancelled (under 5)" : ""}${c.live ? " · from your test" : ""}`)}">
          <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" class="d-hit"/>
          <path d="${path}" class="${c.cancelled ? "d-bar-cancel" : "d-bar"}"/></g>`;
      }).join("")}
      <line x1="${padL}" x2="${W - padR}" y1="${y(8)}" y2="${y(8)}" class="d-target"/>
      <line x1="${padL}" x2="${W - padR}" y1="${y(5)}" y2="${y(5)}" class="d-min"/>
      <text x="${W - padR + 6}" y="${y(8) + 4}" class="d-axis d-axis-strong">target 8</text>
      <text x="${W - padR + 6}" y="${y(5) + 4}" class="d-axis d-axis-crit">minimum 5</text>
      ${cs.map((c, i) => i % 3 === 0 ? `<text x="${padL + i * bw + bw / 2}" y="${H - 10}" class="d-axis" text-anchor="middle">${fmtShort(c.start)}</text>` : "").join("")}
    </svg></div><div class="d-tip" hidden></div></div>
    <div class="d-legend"><span><i class="d-sw-bar"></i>Class ran</span><span><i class="d-sw-cancel"></i>Cancelled (under 5)</span></div>`;
  }
  function fillTable(D) {
    return `<div class="d-scroll"><table class="d-table"><thead><tr><th>Date</th><th>Leader</th><th class="n">Students</th><th>Status</th></tr></thead><tbody>
      ${D.classes.slice().reverse().map((c) => `<tr><td>${fmtDay(c.start)}</td><td>${esc(c.leader)}</td><td class="n">${c.taken}/${SEATS}</td><td>${c.cancelled ? status("crit", "Cancelled") : status(c.taken >= TARGET_FILL ? "good" : "warn", c.taken >= TARGET_FILL ? "At target" : "Below target")}</td></tr>`).join("")}
    </tbody></table></div>`;
  }
  function bindChart() {
    const box = root.querySelector(".d-chart");
    if (!box) return;
    const tip = box.querySelector(".d-tip");
    box.querySelectorAll(".d-bar-g").forEach((g) => {
      const show = (e) => {
        box.querySelectorAll(".d-bar-g.on").forEach((x) => x.classList.remove("on"));
        g.classList.add("on");
        tip.textContent = g.dataset.tip; tip.hidden = false;
        const r = box.getBoundingClientRect(), gr = g.getBoundingClientRect();
        const left = Math.min(Math.max(gr.left - r.left + gr.width / 2, 90), r.width - 90);
        tip.style.left = left + "px";
      };
      g.addEventListener("mouseenter", show);
      g.addEventListener("click", show);
    });
    box.addEventListener("mouseleave", () => { tip.hidden = true; box.querySelectorAll(".d-bar-g.on").forEach((x) => x.classList.remove("on")); });
  }

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-d]");
    if (!el) return;
    if (el.dataset.d === "close") close();
    if (el.dataset.d === "table") { showTable = !showTable; render(); }
  });
  root.addEventListener("change", (e) => { if (e.target.id === "d-rate") { leaderRate = Number(e.target.value); render(); } });
  if (location.hash === "#dashboard") open();
})();
