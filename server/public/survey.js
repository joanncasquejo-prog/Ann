/* Required post-class survey; unlocks notes and certificate. */
(() => {
  const main = document.getElementById("main");
  const token = location.pathname.split("/").pop();
  const { api, esc, day } = BPO;
  const ITEMS = [
    ["q1", "Overall, how would you rate your BPO Experience Leader?", ["Poor", "Excellent"]],
    ["q2", "The leader explained things clearly.", ["Strongly disagree", "Strongly agree"]],
    ["q3", "The feedback on my mock call was specific and useful.", ["Strongly disagree", "Strongly agree"]],
    ["q4", "The leader gave every student a chance to speak.", ["Strongly disagree", "Strongly agree"]],
    ["q5", "I feel more ready for a BPO interview than before the class.", ["Strongly disagree", "Strongly agree"]],
  ];
  const scale = (name, lo, hi, ends, cls = "") => `<div class="scale ${cls}" role="radiogroup">${Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((v) => `<label><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`).join("")}</div><div class="scale-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;

  function done(s) {
    main.innerHTML = `
      <p class="eyebrow">Class on ${day(s.startsAt)}</p>
      <h1 class="app-title">Thanks, ${esc(s.name.split(" ")[0])}!</h1>
      <div class="panel"><h2>Your class materials</h2>
        <ul class="unlocked"><li><a href="/notes">Class notes</a>: introduction template, situation-action-result answer guide, mock-call checklist</li>
        <li><a href="${esc(s.certificateUrl)}">Certificate of attendance</a></li></ul></div>`;
  }

  async function load() {
    let s;
    try { s = await api(`/api/survey/${encodeURIComponent(token)}`); }
    catch (e) { main.innerHTML = `<h1 class="app-title">Survey not available</h1><p class="muted">${esc(e.message)}</p>`; return; }
    if (s.done) return done(s);
    main.innerHTML = `
      <form id="f-survey" class="panel survey" novalidate>
        <p class="eyebrow">Required · about 2 minutes</p>
        <h2>How was your class on ${day(s.startsAt)}?</h2>
        <p class="muted">Complete this survey to get your class notes and certificate of attendance. Your leader sees only combined results, never your individual answers.</p>
        ${ITEMS.map(([id, q, ends], i) => `<fieldset><legend>${i + 1}. ${q}</legend>${scale(id, 1, 5, ends)}</fieldset>`).join("")}
        <fieldset><legend>6. How likely are you to recommend BPO Readiness to a friend or family member?</legend>${scale("nps", 0, 10, ["Not at all likely", "Extremely likely"], "nps")}</fieldset>
        <label for="s-comment" class="survey-comment">7. What should we improve? <span class="muted">(optional)</span><textarea id="s-comment" name="comment" rows="3" maxlength="1000"></textarea></label>
        <p class="form-error" id="s-error" role="alert"></p>
        <button class="btn btn-primary">Submit survey</button>
      </form>`;
    main.querySelector("#f-survey").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const missing = [...ITEMS.map(([id]) => id), "nps"].map((k, i) => (fd[k] === undefined ? i + 1 : null)).filter(Boolean);
      const err = e.target.querySelector("#s-error");
      if (missing.length) { err.textContent = `Answer question${missing.length > 1 ? "s" : ""} ${missing.join(", ")} to submit.`; return; }
      try { done(await api(`/api/survey/${encodeURIComponent(token)}`, fd)); }
      catch (x) { err.textContent = x.message; }
    });
  }
  load();
})();
