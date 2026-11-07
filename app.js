let csrfToken = "";
let mode = "login";
let currentUser = null;

const $ = (id) => document.getElementById(id);
const message = (text, ok = false, target = "message") => {
  const el = $(target);
  el.textContent = text;
  el.className = `message${ok ? " ok" : ""}`;
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function loadCsrf() {
  const data = await request("/api/csrf");
  csrfToken = data.csrfToken;
}

function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("formTitle").textContent = mode === "login" ? "Welcome back" : "Create your demo account";
  $("formSubtitle").textContent = mode === "login"
    ? "Use your own demo account to continue."
    : "Create a test account for this educational project.";
  $("submitButton").innerHTML = mode === "login" ? 'Sign in securely <span>→</span>' : 'Create account <span>→</span>';
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  message("");
}

async function showAccount(user) {
  currentUser = user;
  $("authView").classList.add("hidden");
  $("accountView").classList.remove("hidden");
  $("welcomeText").textContent = `${user.email} · ${user.role}`;
  $("adminArea").classList.toggle("hidden", user.role !== "admin");
  if (user.role === "admin") await loadUsers();
}

async function loadUsers() {
  try {
    const data = await request("/api/admin/users");
    $("userCount").textContent = data.users.length;
    $("loginCount").textContent = data.users.reduce((sum, user) => sum + user.login_count, 0);
    $("usersTable").innerHTML = "";
    if (!data.users.length) {
      $("usersTable").innerHTML = '<tr><td colspan="4">No demo accounts yet.</td></tr>';
      return;
    }
    for (const user of data.users) {
      const tr = document.createElement("tr");
      const values = [
        user.email,
        user.role,
        String(user.login_count),
        user.last_login ? new Date(user.last_login + " UTC").toLocaleString() : "Never"
      ];
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }
      $("usersTable").appendChild(tr);
    }
  } catch (err) {
    $("usersTable").innerHTML = `<tr><td colspan="4">${err.message}</td></tr>`;
  }
}

$("loginTab").addEventListener("click", () => setMode("login"));
$("registerTab").addEventListener("click", () => setMode("register"));
$("refreshButton").addEventListener("click", loadUsers);

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  const endpoint = mode === "login" ? "/api/login" : "/api/register";
  $("submitButton").disabled = true;
  try {
    const data = await request(endpoint, {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: JSON.stringify({ email, password })
    });
    if (mode === "register") {
      message(data.message, true);
      $("password").value = "";
      setMode("login");
      message(data.message, true);
    } else {
      await loadCsrf();
      await showAccount(data.user);
    }
  } catch (err) {
    message(err.message);
  } finally {
    $("submitButton").disabled = false;
  }
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await request("/api/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: JSON.stringify({})
    });
    currentUser = null;
    await loadCsrf();
    $("accountView").classList.add("hidden");
    $("authView").classList.remove("hidden");
    setMode("login");
    message("You have been signed out.", true);
  } catch (err) {
    message(err.message, false, "accountMessage");
  }
});

(async function init() {
  try {
    await loadCsrf();
    const data = await request("/api/me");
    await showAccount(data.user);
    csrfToken = data.csrfToken;
  } catch {
    // No active session; show the sign-in screen.
  }
})();
