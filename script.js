const questions = [
  "I can hold a clear conversation in English with a stranger.",
  "I stay calm when someone is upset or rude to me.",
  "I can type quickly and accurately on a computer.",
  "I'm comfortable learning new software and tools.",
  "I can explain a solution step by step so others understand.",
  "I'm open to working night shifts, weekends, or holidays.",
  "I take feedback well and use it to improve.",
  "I'm consistently on time for commitments."
];
const options = ["Not yet", "Somewhat", "Mostly", "Confident"];

const list = document.querySelector(".quiz-list");
questions.forEach((q, i) => {
  const li = document.createElement("li");
  li.innerHTML = `<p>${q}</p><div class="scale" role="radiogroup">${options
    .map((o, v) => `<label><input type="radio" name="q${i}" value="${v}"><span>${o}</span></label>`)
    .join("")}</div>`;
  list.appendChild(li);
});

const form = document.getElementById("quiz");
const result = document.getElementById("result");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  form.querySelector(".error")?.remove();
  const data = new FormData(form);
  if ([...data.keys()].length < questions.length) {
    const msg = document.createElement("p");
    msg.className = "error";
    msg.textContent = "Please answer every statement to see your result.";
    form.insertBefore(msg, form.querySelector("button"));
    return;
  }
  let total = 0;
  for (const v of data.values()) total += Number(v);
  const pct = Math.round((total / (questions.length * 3)) * 100);

  let title, text;
  if (pct >= 80) {
    title = "You're close to interview-ready.";
    text = "You have a strong foundation. A live class with real feedback will sharpen your answers before the real interview.";
  } else if (pct >= 50) {
    title = "You're almost there.";
    text = "You have solid strengths. Focus on the areas you rated lowest. A live mock call with a trainer is a fast way to find what to fix.";
  } else {
    title = "You're building your foundation.";
    text = "Everyone starts somewhere. Practice with feedback is the fastest way to build confidence. A live class covers every stage of hiring in 3 hours.";
  }

  document.getElementById("score").textContent = pct;
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-text").textContent = text;
  form.hidden = true;
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("retake").addEventListener("click", () => {
  form.reset();
  result.hidden = true;
  form.hidden = false;
});

const toggle = document.querySelector(".nav-toggle");
const links = document.querySelector(".nav-links");
toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.setAttribute("aria-expanded", open);
});
links.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }
});

document.getElementById("year").textContent = new Date().getFullYear();
