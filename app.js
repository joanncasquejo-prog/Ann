/* BPO Readiness test-mode app: sign-up, verification, simulated checkout,
   15-day Solo Pass, device and session rules, and AI mock interviews.
   No real payment, SMS or email is sent. */
(() => {
  const DAY = 86400000;
  const PRICE = 599;
  const PASS_DAYS = 15;
  const STORE_KEY = "bpo-readiness-test-v1";

  const STAGES = [
    { id: 1, name: "Initial screening", mode: "Voice", voice: true, questions: 4,
      brief: "a short initial screening call (about 5 minutes). Ask about the candidate's background, schedule flexibility (night shifts, weekends, holidays) and why they want BPO work. Listen for fluency and clarity.",
      rubric: ["Fluency", "Clarity", "Relevance of answers", "Schedule flexibility"] },
    { id: 2, name: "English assessment", mode: "Voice + text", voice: true, questions: 5,
      brief: "an English assessment. Mix tasks: give a short sentence to repeat back exactly, a grammar question (pick or correct a sentence), and a short listening-comprehension item where you write a 2-3 sentence customer message and ask a question about it.",
      rubric: ["Grammar", "Vocabulary", "Comprehension", "Sentence accuracy"] },
    { id: 3, name: "HR / behavioural interview", mode: "Text", voice: false, questions: 5,
      brief: "an HR / behavioural interview. Ask situational questions (e.g. handling pressure, a conflict with a teammate, a time you went beyond for someone). When an answer is vague, ask one specific follow-up before moving on.",
      rubric: ["Structure (situation, action, result)", "Specificity", "Customer focus", "Professionalism"] },
    { id: 4, name: "Mock call", mode: "Voice", voice: true, questions: 6,
      brief: "a mock customer call. YOU play the customer, not an interviewer, after one opening line that says this is an AI practice mock call. Persona for this call: {persona}. Stay in character, push back realistically, and let the call end naturally once the agent resolves the issue or after about 6 exchanges.",
      rubric: ["Empathy", "Call control", "Resolution", "Professional language"] },
    { id: 5, name: "Final / account interview", mode: "Voice", voice: true, questions: 5,
      brief: "a final account interview for the account type the candidate picks ({account}). Ask account-specific questions and ask the candidate to restate, in a spoken style, an answer to a common HR question.",
      rubric: ["Account knowledge", "Confidence", "Communication", "Role fit"] },
  ];
  const PERSONAS = [
    "a customer disputing a double charge on their monthly bill, polite but firm",
    "an irate caller whose internet has been down for two days and who has called three times already",
    "a confused older customer who cannot log in to their account app after an update",
    "a customer who wants to cancel a subscription and is annoyed by a hidden fee",
  ];
  const ACCOUNTS = ["Voice customer service", "Non-voice (chat and email)", "Healthcare", "Tech support"];

  /* ---------- state ---------- */
  const fresh = () => ({
    step: "signup", offsetDays: 0,
    account: null, verify: { otp: null, tries: 0, mobileOk: false, emailOk: false, held: false },
    order: null, pass: null, devices: [], swapsUsed: 0, flags: [], level: 0, stepUp: null,
    interviews: [], log: [], inbox: [], notice: null, renewing: false,
  });
  let S = load() || fresh();
  let view = null;           // transient interview/report view
  let sample = null;
  let sampleChecked = false;

  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

  const now = () => Date.now() + S.offsetDays * DAY;
  const fmt = (t) => new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
  const maskMobile = (m) => m.replace(/^(\+63)(\d)(\d{2})(\d{3})(\d{4})$/, "$1 $2•• ••• $5");
  const daysLeft = () => S.pass ? Math.max(0, Math.ceil((S.pass.expiry - now()) / DAY)) : 0;

  function log(msg) { S.log.unshift({ t: now(), msg }); S.log = S.log.slice(0, 30); }
  function sms(text) { S.inbox.unshift({ t: now(), kind: "SMS", to: S.account.mobile, text }); }
  function email(text, action) { S.inbox.unshift({ t: now(), kind: "Email", to: S.account.email, text, action }); }

  function passStatus() {
    if (!S.pass) return "none";
    if (["refunded", "terminated", "suspended"].includes(S.pass.status)) return S.pass.status;
    if (S.level >= 3) return "locked";
    return now() >= S.pass.expiry ? "expired" : "active";
  }

  /* ---------- shell ---------- */
  const root = document.getElementById("app");
  const landing = document.getElementById("top");
  const header = document.querySelector(".site-header");
  const footer = document.querySelector(".site-footer");

  function openApp() {
    landing.hidden = true; footer.hidden = true; header.hidden = true;
    root.hidden = false; window.scrollTo(0, 0); render();
  }
  function closeApp() {
    root.hidden = true; landing.hidden = false; footer.hidden = false; header.hidden = false;
    if (location.hash === "#app") history.replaceState(null, "", location.pathname);
  }
  document.querySelectorAll("[data-open-app]").forEach((el) =>
    el.addEventListener("click", (e) => { e.preventDefault(); openApp(); }));
  if (location.hash === "#app") openApp();

  function render() {
    save();
    const st = passStatus();
    const main = view ? (view.type === "interview" ? renderInterview() : renderReport())
      : S.step === "signup" ? renderSignup()
      : S.step === "verify" ? renderVerify()
      : S.step === "pay" ? renderPay()
      : S.step === "gateway" ? renderGateway()
      : renderDashboard(st);
    root.innerHTML = `
      <div class="app-bar">
        <div class="container app-bar-inner">
          <button class="brand link-btn" data-act="home"><span class="brand-mark">B</span> BPO Readiness</button>
          <span class="test-pill">Test mode · no real payments</span>
        </div>
      </div>
      <div class="container app-grid">
        <div class="app-main">${progress()}${main}</div>
        <aside class="test-panel">${renderPanel()}</aside>
      </div>`;
    bind();
  }

  function progress() {
    if (view || !["signup", "verify", "pay", "gateway"].includes(S.step) || S.renewing) return "";
    const steps = ["Sign up", "Verify", "Pay", "Activate"];
    const idx = { signup: 0, verify: 1, pay: 2, gateway: 2 }[S.step];
    return `<ol class="progress">${steps.map((s, i) =>
      `<li class="${i < idx ? "done" : i === idx ? "current" : ""}"><span>${i + 1}</span>${s}</li>`).join("")}</ol>`;
  }

  /* ---------- 1. sign up ---------- */
  function renderSignup() {
    return `
      <h1 class="app-title">Create your account</h1>
      <p class="muted">One account per person. Your mobile number and email can each hold one active account.</p>
      <form id="f-signup" class="form" novalidate>
        <label for="su-name">Full name<input id="su-name" name="name" autocomplete="name" required></label>
        <label for="su-email">Email<input id="su-email" name="email" type="email" autocomplete="email" required></label>
        <label for="su-mobile">PH mobile number<input id="su-mobile" name="mobile" inputmode="tel" placeholder="0917 123 4567" required></label>
        <label for="su-pass">Password<input id="su-pass" name="password" type="password" minlength="8" autocomplete="new-password" required>
          <small>At least 8 characters.</small></label>
        <label class="check" for="su-terms"><input id="su-terms" type="checkbox" name="terms"> I agree to the <a href="terms.html" target="_blank">Terms of Service</a>, including that my pass is for my use only.</label>
        <label class="check" for="su-privacy"><input id="su-privacy" type="checkbox" name="privacy"> I have read the <a href="privacy.html" target="_blank">Privacy Notice</a>.</label>
        <p class="form-error" id="su-error" role="alert"></p>
        <button class="btn btn-primary">Create account</button>
      </form>`;
  }
  function submitSignup(f) {
    const d = Object.fromEntries(new FormData(f));
    const err = (m) => { f.querySelector("#su-error").textContent = m; };
    const mobile = (d.mobile || "").replace(/[\s-]/g, "");
    const m = mobile.match(/^(?:\+?63|0)(9\d{9})$/);
    if (!d.name.trim()) return err("Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return err("Enter a valid email address.");
    if (!m) return err("Enter a PH mobile number like 0917 123 4567.");
    if ((d.password || "").length < 8) return err("Use a password of at least 8 characters.");
    if (!d.terms) return err("Tick the Terms of Service box to continue.");
    if (!d.privacy) return err("Tick the Privacy Notice box to continue.");
    S.account = { name: d.name.trim(), email: d.email.trim(), mobile: "+63" + m[1], created: now() };
    S.verify = { otp: code6(), tries: 0, mobileOk: false, emailOk: false, held: false };
    sms(`BPO Readiness: your verification code is ${S.verify.otp}. It expires in 5 minutes.`);
    email("Confirm your email address for BPO Readiness.", "verify-email");
    log("Account created. Verification code sent by SMS and email link sent.");
    S.step = "verify";
    render();
  }

  /* ---------- 2. verify ---------- */
  function renderVerify() {
    const v = S.verify;
    if (v.held) return `
      <h1 class="app-title">Account held for review</h1>
      <p class="muted">The code was entered wrongly 3 times, so support needs to review this account before you can continue.</p>
      <button class="btn btn-ghost" data-act="support-release">Test: support approves the account</button>`;
    return `
      <h1 class="app-title">Verify it's you</h1>
      <p class="muted">We sent a 6-digit code to <strong>${esc(maskMobile(S.account.mobile))}</strong> and a link to <strong>${esc(S.account.email)}</strong>. Open them in the test inbox on the right.</p>
      <div class="verify-rows">
        <div class="verify-row ${v.mobileOk ? "ok" : ""}">
          <strong>Mobile number</strong>
          ${v.mobileOk ? `<span class="status-ok">Verified</span>` : `
          <form id="f-otp" class="inline-form" novalidate>
            <input id="otp-code" name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" aria-label="SMS code">
            <button class="btn btn-primary btn-sm">Verify</button>
          </form>
          <p class="form-error" role="alert">${v.tries ? `Wrong code. ${3 - v.tries} ${3 - v.tries === 1 ? "try" : "tries"} left.` : ""}</p>
          <button class="link-btn" data-act="resend">Resend code</button>`}
        </div>
        <div class="verify-row ${v.emailOk ? "ok" : ""}">
          <strong>Email</strong>
          ${v.emailOk ? `<span class="status-ok">Verified</span>` : `<span class="muted">Click the link in the email.</span>`}
        </div>
      </div>
      <button class="btn btn-primary" data-act="to-pay" ${v.mobileOk && v.emailOk ? "" : "disabled"}>Continue to payment</button>`;
  }
  function submitOtp(f) {
    const c = f.querySelector("#otp-code").value.trim();
    if (c === S.verify.otp) { S.verify.mobileOk = true; log("Mobile number verified."); }
    else {
      S.verify.tries++;
      if (S.verify.tries >= 3) { S.verify.held = true; log("3 failed codes. Account held for support review."); }
    }
    render();
  }

  /* ---------- 3. pay ---------- */
  function renderPay() {
    const methods = [["gcash", "GCash"], ["maya", "Maya"], ["card", "Debit / credit card"], ["otc", "Over the counter (7-Eleven, Cebuana)"]];
    return `
      <h1 class="app-title">${S.renewing ? "Renew your pass" : "Checkout"}</h1>
      <div class="summary">
        <div><strong>BPO Readiness Solo Pass</strong><p class="muted">15-day pass · single user · ${S.renewing ? "added to your current pass" : "starts when payment is confirmed"}</p></div>
        <div class="summary-price">₱${PRICE}</div>
      </div>
      <form id="f-pay" class="form">
        <fieldset class="methods"><legend>Payment method</legend>
          ${methods.map(([v, l], i) => `<label class="method" for="pm-${v}"><input id="pm-${v}" type="radio" name="method" value="${v}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}
        </fieldset>
        <ul class="terms-list">
          <li>Licensed to ${esc(S.account.name)} only. Up to 2 devices, one session at a time.</li>
          <li>Full refund within 3 days of activation if you've done 3 or fewer mock interviews.</li>
          <li>If the account is confirmed as shared, the pass is cancelled with no refund for remaining days.</li>
        </ul>
        <button class="btn btn-primary">Pay ₱${PRICE}</button>
        ${S.renewing ? `<button type="button" class="link-btn" data-act="cancel-renew">Cancel</button>` : ""}
      </form>`;
  }
  function submitPay(f) {
    const method = new FormData(f).get("method");
    S.order = { id: "BR-" + Math.random().toString(36).slice(2, 8).toUpperCase(), method, status: "awaiting", created: now() };
    log(`Order ${S.order.id} created (${method.toUpperCase()}). Sent to the payment gateway.`);
    S.step = "gateway";
    render();
  }

  /* ---------- simulated gateway ---------- */
  function renderGateway() {
    const o = S.order;
    const label = { gcash: "GCash", maya: "Maya", card: "Card", otc: "Over the counter" }[o.method];
    if (o.status === "pending") return `
      <div class="gateway">
        <p class="eyebrow">Test payment gateway</p>
        <h2>Payment slip issued</h2>
        <p>Pay <strong>₱${PRICE}</strong> at any 7-Eleven or Cebuana branch using reference <strong class="mono">${o.id}</strong>.</p>
        <p class="muted">Your order stays pending, with no access, until the gateway confirms the payment.</p>
        <div class="btn-row">
          <button class="btn btn-primary" data-act="gw-paid">Test: branch confirms payment</button>
          <button class="btn btn-ghost" data-act="gw-expire">Test: slip expires unpaid</button>
        </div>
      </div>`;
    if (o.status === "failed") return `
      <h1 class="app-title">Payment didn't go through</h1>
      <p class="muted">Order ${o.id} was ${o.reason}. You weren't charged and no access was granted.</p>
      <button class="btn btn-primary" data-act="retry-pay">Try again</button>`;
    return `
      <div class="gateway">
        <p class="eyebrow">Test payment gateway</p>
        <h2>${label} · ₱${PRICE}.00</h2>
        <p class="muted">Order ${o.id} · Merchant: BPO Readiness</p>
        <p>This screen stands in for the real gateway. Choose what happens:</p>
        <div class="btn-row">
          ${o.method === "otc"
            ? `<button class="btn btn-primary" data-act="gw-slip">Generate payment slip</button>`
            : `<button class="btn btn-primary" data-act="gw-paid">Approve payment</button>
               <button class="btn btn-ghost" data-act="gw-decline">Decline payment</button>`}
          <button class="btn btn-ghost" data-act="gw-redirect">Return to site without paying</button>
        </div>
      </div>`;
  }
  function webhookPaid() {
    S.order.status = "paid";
    log(`Webhook payment.paid received. Signature verified. Order ${S.order.id} marked paid.`);
    const t = now();
    if (S.renewing && S.pass) {
      const base = Math.max(t, S.pass.expiry);
      S.pass.expiry = base + PASS_DAYS * DAY;
      S.pass.status = "active";
      S.swapsUsed = 0;
      log(`Pass renewed. New expiry ${fmt(S.pass.expiry)}.`);
    } else {
      S.pass = { status: "active", start: t, expiry: t + PASS_DAYS * DAY, payments: 0 };
      S.devices = [{ id: "d1", name: "This browser", added: t, current: true }];
      log(`Pass activated. Expires ${fmt(S.pass.expiry)}. "This browser" registered as device 1.`);
    }
    S.pass.payments = (S.pass.payments || 0) + 1;
    email(`Official receipt ${S.order.id}: BPO Readiness Solo Pass, ₱${PRICE}.00, paid by ${S.order.method.toUpperCase()}. Thank you!`);
    S.renewing = false;
    S.step = "dashboard";
    S.notice = { kind: "ok", text: `Payment confirmed. Your Solo Pass is active until ${fmt(S.pass.expiry)}. Your receipt is in your email.` };
    render();
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(st) {
    const a = S.account, p = S.pass;
    const label = { active: "Active", expired: "Expired", refunded: "Refunded", locked: "Locked", terminated: "Terminated", suspended: "Suspended" }[st];
    const dl = daysLeft();
    const usable = st === "active";
    const done = S.interviews.length;
    const sinceAct = (now() - p.start) / DAY;
    const refundOk = st === "active" && sinceAct <= 3 && done <= 3 && p.payments === 1;
    const banners = [];
    if (S.notice) banners.push(`<div class="banner ${S.notice.kind}">${esc(S.notice.text)}<button class="link-btn" data-act="dismiss">Dismiss</button></div>`);
    if (st === "active" && [3, 1].includes(dl)) banners.push(`<div class="banner warn">Your pass ends in ${dl} day${dl > 1 ? "s" : ""}. Renew to keep practising.</div>`);
    if (st === "active" && dl === 0) banners.push(`<div class="banner warn">Your pass ends today.</div>`);
    if (S.level === 1) banners.push(`<div class="banner warn">We noticed unusual activity. Reminder: your pass is for your use only. You can keep practising normally.</div>`);
    if (S.stepUp) return renderStepUp();
    return `
      ${banners.join("")}
      <div class="dash-head">
        <div>
          <p class="eyebrow">Welcome back</p>
          <h1 class="app-title">${esc(a.name)}</h1>
        </div>
        <span class="status-chip s-${st}">${label}</span>
      </div>

      <div class="stat-row">
        <div class="stat"><span class="stat-label">Days left</span><span class="stat-value">${usable ? dl : 0}</span><span class="stat-sub">${st === "active" ? "until " + fmt(p.expiry) : "ended " + fmt(p.expiry)}</span></div>
        <div class="stat"><span class="stat-label">Mock interviews</span><span class="stat-value">${done}</span><span class="stat-sub">unlimited, one at a time</span></div>
        <div class="stat"><span class="stat-label">Devices</span><span class="stat-value">${S.devices.length}/2</span><span class="stat-sub">${2 - S.swapsUsed} swap${2 - S.swapsUsed === 1 ? "" : "s"} left this pass</span></div>
      </div>

      ${st === "locked" ? `
        <div class="panel">
          <h2>Account locked</h2>
          <p class="muted">Sharing signals continued after re-verification, so a support ticket was opened. Appeal with a valid government ID. Support aims to reply within 2 business days.</p>
          <div class="btn-row"><button class="btn btn-primary" data-act="appeal-ok">Test: appeal approved</button><button class="btn btn-ghost" data-act="appeal-no">Test: sharing confirmed (terminate)</button></div>
        </div>` : ""}
      ${st === "terminated" ? `<div class="panel"><h2>Pass terminated</h2><p class="muted">Sharing was confirmed after review. Unused days were forfeited with no refund. This number and email can't be used for new sign-ups for 12 months. You may appeal once to a second reviewer.</p></div>` : ""}
      ${st === "suspended" ? `<div class="panel"><h2>Account suspended</h2><p class="muted">A chargeback was filed on your payment. Access comes back if the dispute is withdrawn or resolved in your favour.</p><button class="btn btn-ghost" data-act="chargeback-resolve">Test: dispute resolved</button></div>` : ""}

      <section class="panel">
        <div class="panel-head"><h2>Practise</h2>${usable ? "" : `<span class="muted">Locked</span>`}</div>
        <div class="stage-grid">
          ${STAGES.map((s) => {
            const best = bestScore(s.id);
            return `<button class="stage-btn" data-act="start" data-stage="${s.id}" ${usable ? "" : "disabled"}>
              <span class="stage-num-sm">${s.id}</span>
              <span class="stage-txt"><strong>${s.name}</strong><span class="muted">${s.mode}${best != null ? ` · best ${best}` : ""}</span></span>
            </button>`;
          }).join("")}
          <button class="stage-btn full" data-act="start" data-stage="full" ${usable ? "" : "disabled"}>
            <span class="stage-num-sm">★</span><span class="stage-txt"><strong>Full run</strong><span class="muted">All five stages in order</span></span>
          </button>
        </div>
      </section>

      ${done ? `<section class="panel">
        <h2>Your reports</h2>
        <ul class="report-list">
          ${S.interviews.slice().reverse().map((iv, i) => `<li><button class="link-btn" data-act="open-report" data-idx="${S.interviews.length - 1 - i}">
            <span>${esc(STAGES[iv.stage - 1].name)}</span><span class="muted">${fmt(iv.at)}</span><span class="score-pill">${iv.report.overall}</span></button></li>`).join("")}
        </ul></section>` : ""}

      <section class="panel">
        <h2>Pass and devices</h2>
        <ul class="kv">
          <li><span>Plan</span><span>Solo Pass · ₱${PRICE} / 15 days</span></li>
          <li><span>Activated</span><span>${fmt(p.start)}</span></li>
          <li><span>Expires</span><span>${fmt(p.expiry)}</span></li>
          <li><span>Mobile</span><span>${esc(maskMobile(a.mobile))}</span></li>
          ${S.devices.map((d, i) => `<li><span>Device ${i + 1}</span><span>${esc(d.name)}${d.current ? " · signed in" : ""}</span></li>`).join("")}
        </ul>
        <div class="btn-row">
          ${["active", "expired"].includes(st) ? `<button class="btn btn-primary" data-act="renew">Renew · ₱${PRICE}</button>` : ""}
          ${refundOk ? `<button class="btn btn-ghost" data-act="refund">Request refund</button>` : ""}
        </div>
        ${st === "active" && !refundOk ? `<p class="fine">Refunds: full refund within 3 days of activation with 3 or fewer interviews. That window has closed for this pass.</p>` : ""}
      </section>`;
  }
  function bestScore(id) {
    const s = S.interviews.filter((i) => i.stage === id).map((i) => i.report.overall);
    return s.length ? Math.max(...s) : null;
  }

  /* ---------- step-up verification ---------- */
  function renderStepUp() {
    const su = S.stepUp;
    const title = su.reason === "voice" ? "Quick check before your voice interview"
      : su.reason === "device" ? "Verify your new device" : "Verify it's still you";
    const body = su.reason === "voice" ? "Some voice interviews start with a code sent to your registered phone."
      : su.reason === "device" ? `Signing in on "${esc(su.device)}" uses one of your 2 device slots.`
      : "We saw activity that one person usually wouldn't produce. Enter the code, and we'll sign out all devices and ask you to reset your password.";
    return `
      <h1 class="app-title">${title}</h1>
      <p class="muted">${body} Code sent to ${esc(maskMobile(S.account.mobile))}.</p>
      <form id="f-stepup" class="inline-form" novalidate>
        <input id="su-code" inputmode="numeric" maxlength="6" placeholder="6-digit code" aria-label="SMS code">
        <button class="btn btn-primary btn-sm">Verify</button>
      </form>
      <p class="form-error" role="alert">${su.tries ? `Wrong code. ${3 - su.tries} left.` : ""}</p>
      <button class="link-btn" data-act="stepup-cancel">${su.reason === "flag" ? "I can't get the code" : "Cancel"}</button>`;
  }
  function startStepUp(reason, extra = {}) {
    S.stepUp = { reason, code: code6(), tries: 0, ...extra };
    sms(`BPO Readiness: your security code is ${S.stepUp.code}. Don't share this code with anyone.`);
    log(`Step-up code sent (${reason}).`);
  }
  function submitStepUp(f) {
    const su = S.stepUp;
    if (f.querySelector("#su-code").value.trim() === su.code) {
      S.stepUp = null;
      if (su.reason === "voice") { log("Voice interview code verified."); render(); return beginInterview(su.stage, su.full); }
      if (su.reason === "device") addDevice(su.device);
      if (su.reason === "flag") {
        S.level = 2; S.flagsClearedAt = now();
        S.devices = S.devices.filter((d) => d.current);
        S.notice = { kind: "ok", text: "Verified. All other devices were signed out. In the real app you'd now reset your password." };
        log("Step-up passed. Other devices signed out, password reset required.");
      }
    } else {
      su.tries++;
      if (su.tries >= 3) {
        S.stepUp = null;
        if (su.reason === "flag") lock("Step-up verification failed.");
        else { addFlag("Security code failed or abandoned"); S.notice = { kind: "warn", text: "The code wasn't confirmed." }; }
      }
    }
    render();
  }

  /* ---------- devices, flags, enforcement ---------- */
  function addDevice(name) {
    S.devices.forEach((d) => (d.current = false));
    if (S.devices.length < 2) {
      S.devices.push({ id: "d" + Date.now(), name, added: now(), current: true });
      log(`"${name}" registered as device ${S.devices.length}.`);
    } else {
      const old = S.devices.shift();
      S.swapsUsed++;
      S.devices.push({ id: "d" + Date.now(), name, added: now(), current: true });
      log(`Device swap: "${old.name}" replaced by "${name}". ${2 - S.swapsUsed} swaps left.`);
    }
    S.notice = { kind: "warn", text: `Signed in on "${name}". Your session on the other device ended (one session at a time).` };
  }
  function addFlag(reason) {
    S.flags.push({ t: now(), reason });
    log(`Risk flag: ${reason}.`);
    const recent = S.flags.filter((f) => now() - f.t <= 7 * DAY && (!S.flagsClearedAt || f.t > S.flagsClearedAt));
    if (S.level === 2 && S.flagsClearedAt && now() - S.flagsClearedAt <= 30 * DAY) return lock("Flags returned within 30 days of step-up.");
    if (recent.length >= 2) { startStepUp("flag"); return; }
    if (S.level < 1) S.level = 1;
  }
  function lock(why) {
    S.level = 3;
    log(`Account locked: ${why} Support ticket opened.`);
  }

  /* ---------- interviews ---------- */
  async function ensureSample() {
    if (sampleChecked) return sample;
    sampleChecked = true;
    try { sample = window.claude?.use ? await window.claude.use("sample") : null; } catch { sample = null; }
    return sample;
  }

  function startStage(stageArg) {
    if (passStatus() !== "active") return;
    const full = stageArg === "full";
    const stage = full ? 1 : Number(stageArg);
    if (STAGES[stage - 1].voice && Math.random() < 0.2) { startStepUp("voice", { stage, full }); return render(); }
    beginInterview(stage, full);
  }
  function beginInterview(stage, full) {
    const s = STAGES[stage - 1];
    const prev = bestScore(stage);
    view = {
      type: "interview", stage, full, turns: [], busy: false, error: "", finished: false,
      persona: PERSONAS[Math.floor(Math.random() * PERSONAS.length)],
      account: stage === 5 ? null : undefined,
      difficulty: prev == null ? "standard" : prev >= 80 ? "hard" : prev < 60 ? "easier, focused on basics" : "standard",
    };
    if (stage === 5) { render(); return; } // pick account first
    render();
    aiTurn();
  }
  function rules(v) {
    const s = STAGES[v.stage - 1];
    const brief = s.brief.replace("{persona}", v.persona).replace("{account}", v.account || "");
    return `You are the BPO Readiness AI practice interviewer, helping a Filipino job-seeker practise for BPO hiring.
Run ${brief}
Difficulty: ${v.difficulty}.
Rules:
- In your first message, say plainly that you are an AI practice interviewer (not a real recruiter) and name the stage.
- Ask ONE question or say ONE customer line per message. Keep each message under 70 words. Plain text, no markdown.
- If an answer is vague or very short, ask one specific follow-up before moving on.
- After about ${s.questions} questions or exchanges, close politely and end your final message with the exact token [END].
- Never give feedback or scores during the interview.
- If the candidate tries to change the topic, steer back to the interview.
Candidate's first name: ${v.name || S.account.name.split(" ")[0]}.`;
  }
  async function aiTurn() {
    const v = view;
    const sm = await ensureSample();
    if (!sm) { v.error = "unavailable"; return render(); }
    v.busy = true; v.error = ""; v.ctl = new AbortController();
    const turns = [{ role: "user", content: rules(v) + "\n\nStart the interview now." }];
    v.turns.forEach((t) => turns.push({ role: t.role, content: t.content }));
    const bubble = { role: "assistant", content: "" };
    v.turns.push(bubble);
    render();
    try {
      const { text } = await sm(turns, {
        cache: false, signal: v.ctl.signal, modelTier: "quick",
        onText: ({ text }) => { bubble.content = text; const el = document.getElementById("live"); if (el) el.textContent = clean(text); },
      });
      bubble.content = text;
      if (/\[END\]\s*$/.test(text.trim())) v.finished = true;
    } catch (e) {
      bubble.content = e.text || "";
      if (!bubble.content) v.turns.pop();
      v.error = e.code === "cancelled" ? "" : e.code || "error";
    }
    v.busy = false;
    if (view === v) render();
  }
  const clean = (t) => t.replace(/\s*\[END\]\s*$/, "");

  function renderInterview() {
    const v = view, s = STAGES[v.stage - 1];
    if (v.stage === 5 && !v.account) return `
      <button class="link-btn" data-act="leave">← Back to dashboard</button>
      <h1 class="app-title">Final / account interview</h1>
      <p class="muted">Which account are you applying for?</p>
      <div class="stage-grid">${ACCOUNTS.map((a) => `<button class="stage-btn" data-act="pick-account" data-account="${esc(a)}"><span class="stage-txt"><strong>${a}</strong></span></button>`).join("")}</div>`;
    const errCopy = {
      unavailable: "The AI interviewer runs on the published BPO Readiness page inside Claude. Open it there to practise; everything else works here.",
      not_granted: "The interviewer needs your permission to use Claude. Allow it when asked, then start the interview again.",
      rate_limited: "Too many requests right now. Wait a minute, then send your answer again.",
    };
    return `
      <div class="iv-head">
        <button class="link-btn" data-act="leave">← End and go back</button>
        <span class="muted">${v.full ? `Full run · stage ${v.stage} of 5` : "Single stage"}</span>
      </div>
      <h1 class="app-title">${s.name}</h1>
      <p class="muted">${s.voice ? "Voice stage running in text: voice isn't available in this test build, so it uses the text fallback. " : ""}${v.stage === 4 ? "The AI plays the customer. You're the agent." : ""}</p>
      <div class="chat" id="chat" aria-live="polite">
        ${v.turns.map((t, i) => {
          const live = v.busy && i === v.turns.length - 1;
          return `<div class="msg ${t.role === "assistant" ? "ai" : "me"}"><span class="who">${t.role === "assistant" ? (v.stage === 4 ? "Customer (AI)" : "AI interviewer") : "You"}</span><p ${live ? 'id="live"' : ""}>${esc(clean(t.content)) || (live ? "Thinking…" : "")}</p></div>`;
        }).join("")}
      </div>
      ${v.error ? `<p class="banner warn">${esc(errCopy[v.error] || "Something went wrong reaching the interviewer. Send your answer again.")}</p>` : ""}
      ${v.finished ? `
        <div class="btn-row"><button class="btn btn-primary" data-act="feedback">Finish and get feedback</button></div>` : `
        <form id="f-answer" class="answer" novalidate>
          <label for="answer" class="sr-only">Your answer</label>
          <textarea id="answer" rows="3" placeholder="${v.stage === 4 ? "Reply to the customer…" : "Type your answer…"}" ${v.busy || v.error === "unavailable" ? "disabled" : ""}></textarea>
          <div class="btn-row">
            ${v.busy ? `<button type="button" class="btn btn-ghost" data-act="stop">Stop</button>` : `<button class="btn btn-primary" ${v.error === "unavailable" ? "disabled" : ""}>Send</button>`}
            ${v.turns.filter((t) => t.role === "user").length >= 2 && !v.busy ? `<button type="button" class="btn btn-ghost" data-act="feedback">Finish early and get feedback</button>` : ""}
          </div>
        </form>`}
      <p class="watermark">Licensed to ${esc(S.account.name)} · ${esc(maskMobile(S.account.mobile))}</p>`;
  }
  function submitAnswer(f) {
    const ta = f.querySelector("#answer");
    const text = ta.value.trim();
    if (!text || view.busy) return;
    const last = view.turns[view.turns.length - 1];
    if (last && last.role === "user") last.content += "\n" + text;
    else view.turns.push({ role: "user", content: text });
    aiTurn();
  }

  async function getFeedback() {
    const v = view, s = STAGES[v.stage - 1];
    const sm = await ensureSample();
    if (!sm) { v.error = "unavailable"; return render(); }
    v.busy = true; v.finished = true; render();
    const transcript = v.turns.map((t) => `${t.role === "assistant" ? (v.stage === 4 ? "CUSTOMER" : "INTERVIEWER") : "CANDIDATE"}: ${clean(t.content)}`).join("\n");
    const prompt = `You grade BPO practice interviews for BPO Readiness. Stage: ${s.name}${v.account ? " (" + v.account + ")" : ""}. Difficulty: ${v.difficulty}.
Grade only the CANDIDATE's turns. Be honest and specific; quote short phrases from their answers where useful.
Rubric items (score each 0-100): ${s.rubric.join("; ")}.
Return ONLY JSON with this shape:
{"scores":[{"item":"<rubric item>","score":<0-100>,"note":"<one sentence>"}],
 "overall":<0-100>,
 "fixes":["<specific fix 1>","<specific fix 2>","<specific fix 3>"],
 "stronger_sample":${v.stage === 3 ? '"<a stronger version of one of their answers, under 90 words>"' : "null"},
 "readiness_level":${v.stage === 5 ? '"<one of: Ready to apply | Almost ready | Keep practising>"' : "null"},
 "next_drill":"<the one drill to do next, one sentence>"}

TRANSCRIPT:
${transcript}`;
    try {
      const r = await sm.json(prompt, { modelTier: "default" });
      if (!r || !Array.isArray(r.scores) || !Array.isArray(r.fixes)) throw { code: "bad_output" };
      r.overall = Math.max(0, Math.min(100, Math.round(Number(r.overall) || 0)));
      const iv = { stage: v.stage, at: now(), transcript: v.turns.map((t) => ({ role: t.role, content: clean(t.content) })), report: r, account: v.account, difficulty: v.difficulty };
      S.interviews.push(iv);
      log(`${s.name} completed. Overall ${r.overall}.`);
      view = { type: "report", idx: S.interviews.length - 1, full: v.full };
    } catch (e) {
      v.busy = false;
      v.error = e?.code === "not_granted" ? "not_granted" : e?.code === "rate_limited" ? "rate_limited" : "feedback";
    }
    render();
  }

  function renderReport() {
    const iv = S.interviews[view.idx], r = iv.report, s = STAGES[iv.stage - 1];
    const nextStage = view.full && iv.stage < 5 ? iv.stage + 1 : null;
    return `
      <button class="link-btn" data-act="leave">← Back to dashboard</button>
      <div class="report-head">
        <div><p class="eyebrow">Feedback report · ${fmt(iv.at)}</p><h1 class="app-title">${s.name}</h1>
        ${r.readiness_level ? `<p class="readiness">Overall readiness: <strong>${esc(r.readiness_level)}</strong></p>` : ""}</div>
        <div class="big-score">${r.overall}<span>/100</span></div>
      </div>
      <section class="panel">
        <h2>Score per rubric item</h2>
        <ul class="rubric">
          ${r.scores.map((x) => `<li><div class="rubric-top"><span>${esc(x.item)}</span><span class="tabular">${Math.round(x.score)}</span></div>
            <div class="bar"><span style="width:${Math.max(0, Math.min(100, x.score))}%"></span></div><p class="muted">${esc(x.note)}</p></li>`).join("")}
        </ul>
      </section>
      <section class="panel">
        <h2>Three fixes for next time</h2>
        <ol class="fixes">${r.fixes.slice(0, 3).map((f) => `<li>${esc(f)}</li>`).join("")}</ol>
        ${r.stronger_sample ? `<h3>A stronger answer</h3><blockquote>${esc(r.stronger_sample)}</blockquote>` : ""}
        <h3>Your next drill</h3><p>${esc(r.next_drill)}</p>
      </section>
      <details class="panel transcript"><summary>Transcript</summary>
        ${iv.transcript.map((t) => `<p><strong>${t.role === "assistant" ? (iv.stage === 4 ? "Customer (AI)" : "AI interviewer") : "You"}:</strong> ${esc(t.content)}</p>`).join("")}
      </details>
      <div class="btn-row">
        ${nextStage && passStatus() === "active" ? `<button class="btn btn-primary" data-act="next-stage" data-stage="${nextStage}">Continue to stage ${nextStage}</button>` : ""}
        ${passStatus() === "active" ? `<button class="btn ${nextStage ? "btn-ghost" : "btn-primary"}" data-act="start" data-stage="${iv.stage}">Practise this stage again</button>` : ""}
      </div>
      <p class="fine">This report was produced by an AI practice interviewer. A readiness score is not a job offer or a hiring guarantee.</p>
      <p class="watermark">Licensed to ${esc(S.account.name)} · ${esc(maskMobile(S.account.mobile))}</p>`;
  }

  /* ---------- test panel ---------- */
  function renderPanel() {
    const st = passStatus();
    const hasPass = !!S.pass;
    return `
      <div class="tp-block">
        <h3>Test inbox</h3>
        ${S.inbox.length ? `<ul class="inbox">${S.inbox.slice(0, 6).map((m, i) => `
          <li><span class="tp-meta">${m.kind} · ${esc(m.kind === "SMS" ? maskMobile(m.to) : m.to)}</span>
          <span>${esc(m.text)}</span>
          ${m.action === "verify-email" && !S.verify.emailOk ? `<button class="link-btn" data-act="click-email">Open verification link</button>` : ""}</li>`).join("")}</ul>`
          : `<p class="muted small">SMS codes and emails will show up here.</p>`}
      </div>
      ${hasPass && !view ? `
      <div class="tp-block">
        <h3>Test controls</h3>
        <p class="muted small">Today in test time: ${fmt(now())}</p>
        <div class="tp-btns">
          <button class="btn btn-ghost btn-sm" data-act="t-day">Skip ahead 1 day</button>
          <button class="btn btn-ghost btn-sm" data-act="t-expire">Skip to expiry</button>
          ${st === "active" ? `
          <button class="btn btn-ghost btn-sm" data-act="t-device">Sign in on a new device</button>
          <button class="btn btn-ghost btn-sm" data-act="t-flag">Raise a sharing flag</button>
          <button class="btn btn-ghost btn-sm" data-act="t-outage">AI down 4+ hours</button>
          <button class="btn btn-ghost btn-sm" data-act="t-chargeback">File a chargeback</button>` : ""}
        </div>
      </div>` : ""}
      <div class="tp-block">
        <h3>Event log</h3>
        ${S.log.length ? `<ul class="evlog">${S.log.slice(0, 8).map((l) => `<li>${esc(l.msg)}</li>`).join("")}</ul>` : `<p class="muted small">Nothing yet.</p>`}
      </div>
      <button class="link-btn danger" data-act="reset">Reset test account</button>`;
  }

  /* ---------- events ---------- */
  function bind() {
    const on = (id, fn) => { const f = document.getElementById(id); if (f) f.addEventListener("submit", (e) => { e.preventDefault(); fn(f); }); };
    on("f-signup", submitSignup);
    on("f-otp", submitOtp);
    on("f-pay", submitPay);
    on("f-stepup", submitStepUp);
    on("f-answer", submitAnswer);
    const ta = document.getElementById("answer");
    if (ta) {
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitAnswer(ta.form); } });
      if (!ta.disabled) ta.focus();
    }
    const chat = document.getElementById("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  const actions = {
    home: () => { view = null; closeApp(); },
    resend: () => { S.verify.otp = code6(); sms(`BPO Readiness: your verification code is ${S.verify.otp}.`); log("Verification code resent."); },
    "click-email": () => { S.verify.emailOk = true; log("Email verified."); },
    "support-release": () => { S.verify.held = false; S.verify.tries = 0; S.verify.otp = code6(); sms(`BPO Readiness: your verification code is ${S.verify.otp}.`); log("Support reviewed and released the account."); },
    "to-pay": () => { S.step = "pay"; },
    "retry-pay": () => { S.step = "pay"; },
    "gw-paid": () => webhookPaid(),
    "gw-decline": () => { S.order.status = "failed"; S.order.reason = "declined"; log(`Webhook payment.failed for ${S.order.id}. Order cancelled.`); },
    "gw-slip": () => { S.order.status = "pending"; log(`OTC slip issued for ${S.order.id}. Order pending; no access.`); },
    "gw-expire": () => { S.order.status = "failed"; S.order.reason = "not paid before the slip expired"; log(`Order ${S.order.id} expired unpaid. Cancelled.`); },
    "gw-redirect": () => { log(`Browser returned from gateway for ${S.order.id}, but no webhook arrived. Order not marked paid.`); S.order.status = "failed"; S.order.reason = "not confirmed by the gateway"; },
    "cancel-renew": () => { S.renewing = false; S.step = "dashboard"; },
    renew: () => { S.renewing = true; S.step = "pay"; },
    refund: () => { S.pass.status = "refunded"; S.devices.forEach((d) => (d.current = false)); email(`Refund of ₱${PRICE}.00 for order ${S.order.id} is on its way.`); log("Refund approved (within 3 days, 3 or fewer interviews). Pass ended."); },
    dismiss: () => { S.notice = null; },
    start: (el) => { view = null; startStage(el.dataset.stage); },
    "next-stage": (el) => { const st = Number(el.dataset.stage); view = null; if (STAGES[st - 1].voice && Math.random() < 0.2) startStepUp("voice", { stage: st, full: true }); else beginInterview(st, true); },
    "pick-account": (el) => { view.account = el.dataset.account; render(); aiTurn(); return true; },
    leave: () => { view?.ctl?.abort(); view = null; },
    stop: () => { view?.ctl?.abort(); },
    feedback: () => { getFeedback(); return true; },
    "open-report": (el) => { view = { type: "report", idx: Number(el.dataset.idx) }; },
    "stepup-cancel": () => { const su = S.stepUp; S.stepUp = null; if (su.reason === "flag") lock("Step-up verification abandoned."); else if (su.reason === "voice") addFlag("Code before voice interview abandoned"); },
    "appeal-ok": () => { S.level = 0; S.flags = []; S.flagsClearedAt = null; S.notice = { kind: "ok", text: "Appeal approved. Your account is unlocked." }; log("Appeal approved by support. Account unlocked."); },
    "appeal-no": () => { S.pass.status = "terminated"; log("Sharing confirmed after human review. Pass terminated, no refund. Number and email blocked for 12 months."); },
    "chargeback-resolve": () => { S.pass.status = "active"; log("Chargeback resolved in the customer's favour. Access restored."); },
    "t-day": () => { S.offsetDays++; log("Test: 1 day passed."); if (passStatus() === "expired") log("Pass expired. Content locked; reports kept for 12 months."); },
    "t-expire": () => { S.offsetDays += Math.max(1, Math.ceil((S.pass.expiry - now()) / DAY)); log("Test: jumped to expiry. Content locked; reports kept for 12 months."); },
    "t-device": () => {
      const names = ["Android phone", "Office laptop", "Tablet", "Internet café PC", "iPhone"];
      const name = names[Math.floor(Math.random() * names.length)];
      if (S.devices.length >= 2 && S.swapsUsed >= 2) { addFlag("Device swap requested above the allowance"); S.notice = { kind: "warn", text: `"${name}" needs support review: you've used both device swaps for this pass.` }; return; }
      startStepUp("device", { device: name });
    },
    "t-flag": () => { const r = ["Logins from Manila and Cebu within 2 hours", "Daily usage far above normal", "Repeated failed passwords from a new device"]; addFlag(r[Math.floor(Math.random() * r.length)]); },
    "t-outage": () => { S.pass.expiry += DAY; S.notice = { kind: "ok", text: `The AI interviewer was down for more than 4 hours, so we added 1 day. New expiry: ${fmt(S.pass.expiry)}.` }; log("AI outage over 4 hours. Pass extended by 1 day."); },
    "t-chargeback": () => { S.pass.status = "suspended"; log("Chargeback filed. Account suspended."); },
    reset: () => { S = fresh(); view = null; log("Test account reset."); },
  };
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    e.preventDefault();
    const fn = actions[el.dataset.act];
    if (!fn) return;
    const handled = fn(el);
    if (handled !== true && (S.step !== "home")) render();
  });
})();
