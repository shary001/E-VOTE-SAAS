// Tiny fetch wrapper: attaches the JWT, throws on non-2xx with the server's
// error message so callers can just try/catch and show it.
async function api(method, path, body) {
  const token = localStorage.getItem("voting_token");
  const res = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function downloadAuthFile(path, defaultFilename = "export.csv") {
  const token = localStorage.getItem("voting_token");
  const res = await fetch("/api" + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let errText = "Download failed";
    try { const j = await res.json(); errText = j.error || errText; } catch {}
    throw new Error(errText);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : defaultFilename;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
}

function getSession() {
  const raw = localStorage.getItem("voting_user");
  return raw ? JSON.parse(raw) : null;
}
function saveSession(token, user) {
  localStorage.setItem("voting_token", token);
  localStorage.setItem("voting_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("voting_token");
  localStorage.removeItem("voting_user");
}
function setButtonBusy(button, busy, busyLabel = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.defaultLabel = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || button.textContent;
  }
}
function requireSession(allowedRoles) {
  const user = getSession();
  if (!user || (allowedRoles && !allowedRoles.includes(user.role))) {
    window.location.href = "/login.html";
    return null;
  }
  return user;
}

// Renders the top bar for the given user (or a logged-out version) into
// whatever element has id="topbar-root". Called once per page.
function renderTopbar(activePath) {
  const root = document.getElementById("topbar-root");
  if (!root) return;
  const user = getSession();
  const homeFor = (u) => !u ? "/" :
    u.role === "super_admin" ? "/superadmin/dashboard.html" :
    u.role === "org_admin" ? "/orgadmin/dashboard.html" : "/voter/elections.html";

  const links = [];
  if (user?.role === "org_admin") {
    links.push(["/orgadmin/dashboard.html", "Elections"]);
    links.push(["/orgadmin/roster.html", "Members Roster"]);
  }
  if (user?.role === "member" || user?.role === "candidate") {
    links.push(["/voter/elections.html", "Elections"]);
  }
  if (user?.role === "super_admin") {
    links.push(["/superadmin/dashboard.html", "Overview & Organizations"]);
  }
  if (user) links.push(["/password-change.html", "Account"]);

  root.innerHTML = `
    <div class="topbar"><div class="topbar-inner">
      <a class="brand" href="${homeFor(user)}">${sealSvg()} Civic Ledger</a>
      <nav>
        ${links.map(([href, label]) => `<a href="${href}" class="${activePath === href ? "current" : ""}">${label}</a>`).join("")}
        ${user
          ? `<span class="meta" style="display:inline-flex;align-items:center;gap:6px;">
              ${escapeHtml(user.full_name)}
              ${user.role === "candidate" ? ' <span class="badge badge-approved">Candidate</span>' : ""}
              ${user.role === "super_admin" ? ' <span class="badge badge-pending">Platform Admin</span>' : ""}
              ${user.role === "org_admin" ? ' <span class="badge badge-open">Org Admin</span>' : ""}
             </span>
             <a href="#" id="logout-link" class="btn btn-sm btn-ghost" style="padding:4px 10px;">Log out</a>`
          : `<a href="/login.html" class="btn btn-sm btn-primary">Log in</a>`}
      </nav>
    </div></div>`;
  const logout = document.getElementById("logout-link");
  if (logout) logout.addEventListener("click", (e) => { e.preventDefault(); clearSession(); window.location.href = "/"; });
}

function sealSvg() {
  return `<svg class="seal" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="14.5" stroke="currentColor" stroke-width="1.6"/>
    <path d="M16 8l2.2 5.6 6 .4-4.6 3.8 1.6 5.8L16 20.6l-5.2 3-1.6-5.8-4.6-3.8 6-.4L16 8z" fill="currentColor"/>
  </svg>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtTimeAgo(iso) {
  if (!iso) return "—";
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}
