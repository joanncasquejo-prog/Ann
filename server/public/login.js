// Sign-in form shared by the owner and leader pages.
window.BPOLogin = function (main, title, onDone) {
  const { api, esc } = BPO;
  main.innerHTML = `
    <form id="f-login" class="form login" novalidate>
      <h1 class="app-title">${esc(title)}</h1>
      <label for="l-email">Email<input id="l-email" name="email" type="email" autocomplete="username" required></label>
      <label for="l-pw">Password<input id="l-pw" name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" id="l-error" role="alert"></p>
      <button class="btn btn-primary">Sign in</button>
    </form>`;
  main.querySelector("#f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/login", Object.fromEntries(new FormData(e.target))); onDone(); }
    catch (err) { main.querySelector("#l-error").textContent = err.message; }
  });
};
