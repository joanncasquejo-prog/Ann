/* BPO Readiness owner dashboard, test mode: a seeded sample of the last
   4 weeks plus the bookings and surveys made in the test booking app.
   Rendering lives in dashboard-view.js. */
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

  const root = document.getElementById("dash");
  let view = null;
  function open() {
    [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer"), document.getElementById("app")].forEach((p) => p && (p.hidden = true));
    root.hidden = false; window.scrollTo(0, 0);
    if (!view) view = window.BPODashboard.mount(root, collect, {
      backLabel: "← Website", pill: "Test mode · sample data + your test bookings",
      footnote: "Sample data for 3 example leaders and 3 example referral codes, plus anything you do in the test booking app. The live owner page reads from the booking system.",
      onClose: close,
    });
    view.refresh();
  }
  function close() {
    root.hidden = true;
    [document.getElementById("top"), document.querySelector(".site-header"), document.querySelector(".site-footer")].forEach((p) => (p.hidden = false));
    if (location.hash === "#dashboard") history.replaceState(null, "", location.pathname);
  }
  window.bpoOpenDashboard = open;
  if (location.hash === "#dashboard") open();
})();
