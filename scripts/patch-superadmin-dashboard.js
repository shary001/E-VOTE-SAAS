const fs = require('fs');
let src = fs.readFileSync('public/superadmin/dashboard.html', 'utf8');

// 1. Add "Edit" and "Delete" buttons to the Organization action column in renderOrgsTable
const oldOrgActions = `          <button class="btn btn-sm btn-ghost" data-view-org="\${o.id}">Details</button>
          \${actionBtnFor(o)}`;

const newOrgActions = `          <button class="btn btn-sm btn-ghost" data-view-org="\${o.id}">Details</button>
          <button class="btn btn-sm btn-ghost" data-edit-org="\${o.id}" data-name="\${escapeHtml(o.name)}" data-slug="\${escapeHtml(o.slug)}">Edit</button>
          \${actionBtnFor(o)}
          <button class="btn btn-sm btn-danger" data-delete-org="\${o.id}" data-name="\${escapeHtml(o.name)}">Delete</button>`;

if (src.includes(oldOrgActions)) {
  src = src.replace(oldOrgActions, newOrgActions);
  console.log('Org table action buttons updated.');
} else {
  console.warn('Could not find oldOrgActions');
}

// 2. Add Users Section HTML right after the Organizations section (before Audit Log)
const auditSectionMarker = `  <!-- Audit Log Section -->`;
const usersSectionHtml = `  <!-- Users & Administrators Section -->
  <div style="margin-top:48px">
    <div class="page-head" style="margin-bottom:14px">
      <div>
        <h2>Users &amp; Administrators</h2>
        <p class="meta">Manage accounts, change system roles, assign organizations, and reset credentials.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm" id="new-user-btn">+ Add User / Admin</button>
      </div>
    </div>

    <div class="page-head" style="margin-bottom:14px">
      <div class="tab-bar" id="user-tabs" style="margin-bottom:0">
        <button type="button" class="tab-btn active" data-user-filter="all">All Accounts <span class="count-pill" id="pill-users-all">0</span></button>
        <button type="button" class="tab-btn" data-user-filter="super_admin">Super Admins <span class="count-pill" id="pill-users-super">0</span></button>
        <button type="button" class="tab-btn" data-user-filter="org_admin">Org Admins <span class="count-pill" id="pill-users-org">0</span></button>
        <button type="button" class="tab-btn" data-user-filter="member">Members &amp; Candidates <span class="count-pill" id="pill-users-members">0</span></button>
      </div>
      <div class="filter-toolbar" style="margin-bottom:0">
        <div class="filter-search">
          <svg class="filter-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="user-search" placeholder="Search by name, email, or org…">
        </div>
      </div>
    </div>

    <div class="table-wrap panel-plain">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Organization</th>
            <th>Email Verified</th>
            <th>Joined</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody id="users-body">
          <tr><td colspan="6" class="empty-state">Loading users…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  `;

if (src.includes(auditSectionMarker)) {
  src = src.replace(auditSectionMarker, usersSectionHtml + auditSectionMarker);
  console.log('Users section HTML inserted.');
} else {
  console.warn('Could not find auditSectionMarker');
}

// 3. Update JavaScript logic: rawUsers state, loadData, renderUsersTable, modal handlers
const scriptMarker = `let rawOrgs = [];`;
const scriptState = `let rawOrgs = [];
let rawUsers = [];
let currentUserFilter = "all";`;

if (src.includes(scriptMarker)) {
  src = src.replace(scriptMarker, scriptState);
  console.log('Script state updated.');
}

const loadDataOld = `    const [overview, orgs, analytics, audit, system] = await Promise.all([
      api("GET", "/superadmin/overview"),
      api("GET", "/superadmin/organizations"),
      api("GET", "/superadmin/analytics"),
      api("GET", "/superadmin/audit-log"),
      api("GET", "/superadmin/system-info"),
    ]);`;

const loadDataNew = `    const [overview, orgs, analytics, audit, system, usersList] = await Promise.all([
      api("GET", "/superadmin/overview"),
      api("GET", "/superadmin/organizations"),
      api("GET", "/superadmin/analytics"),
      api("GET", "/superadmin/audit-log"),
      api("GET", "/superadmin/system-info"),
      api("GET", "/superadmin/users"),
    ]);
    rawUsers = usersList || [];`;

if (src.includes(loadDataOld)) {
  src = src.replace(loadDataOld, loadDataNew);
  console.log('loadData updated.');
}

const renderCallOld = `    renderOrgsTable();
    renderAuditTable();`;

const renderCallNew = `    renderOrgsTable();
    renderUsersTable();
    renderAuditTable();`;

if (src.includes(renderCallOld)) {
  src = src.replace(renderCallOld, renderCallNew);
  console.log('render calls updated.');
}

// 4. Append user table renderer, edit/delete org listeners, and user CRUD handlers before loadData()
const beforeLoadData = `loadData();`;
const newCrudFunctions = `
// ---------------- User Table & CRUD Functions
function renderUsersTable() {
  const search = (document.getElementById("user-search")?.value || "").toLowerCase().trim();

  // Update pills
  const superCount = rawUsers.filter(u => u.role === "super_admin").length;
  const orgCount = rawUsers.filter(u => u.role === "org_admin").length;
  const memberCount = rawUsers.filter(u => ["member", "candidate"].includes(u.role)).length;
  document.getElementById("pill-users-all").textContent = rawUsers.length;
  document.getElementById("pill-users-super").textContent = superCount;
  document.getElementById("pill-users-org").textContent = orgCount;
  document.getElementById("pill-users-members").textContent = memberCount;

  const filtered = rawUsers.filter(u => {
    if (currentUserFilter === "super_admin" && u.role !== "super_admin") return false;
    if (currentUserFilter === "org_admin" && u.role !== "org_admin") return false;
    if (currentUserFilter === "member" && !["member", "candidate"].includes(u.role)) return false;
    if (search) {
      const matchName = (u.full_name || "").toLowerCase().includes(search);
      const matchEmail = (u.email || "").toLowerCase().includes(search);
      const matchOrg = (u.organization_name || "").toLowerCase().includes(search);
      if (!matchName && !matchEmail && !matchOrg) return false;
    }
    return true;
  });

  const tbody = document.getElementById("users-body");
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users match this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(u => \`
    <tr>
      <td>
        <strong style="color:var(--text-white)">\${escapeHtml(u.full_name)}</strong>
        <br><small class="meta">\${escapeHtml(u.email)}</small>
      </td>
      <td>
        <span class="badge \${u.role === 'super_admin' ? 'badge-draft' : u.role === 'org_admin' ? 'badge-pending' : 'badge-approved'}">
          \${u.role}
        </span>
      </td>
      <td>
        \${u.organization_name ? \`<span style="font-weight:600">\${escapeHtml(u.organization_name)}</span>\` : '<span class="meta">— Platform (None) —</span>'}
      </td>
      <td>
        \${u.email_verified ? '<span style="color:var(--success);font-weight:600">✓ Verified</span>' : '<span class="meta" style="color:var(--warning)">Unverified</span>'}
      </td>
      <td>
        <span title="\${escapeHtml(fmtDate(u.created_at))}">\${fmtTimeAgo(u.created_at)}</span>
      </td>
      <td style="text-align:right">
        <div style="display:inline-flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-sm btn-ghost" data-edit-user="\${u.id}">Edit</button>
          \${u.id !== user.id ? \`<button class="btn btn-sm btn-danger" data-delete-user="\${u.id}" data-name="\${escapeHtml(u.full_name)}">Delete</button>\` : '<span class="meta" style="font-size:0.75rem;padding:4px">(You)</span>'}
        </div>
      </td>
    </tr>
  \`).join("");

  // Attach Edit User handlers
  tbody.querySelectorAll("[data-edit-user]").forEach(btn => {
    btn.addEventListener("click", () => {
      const u = rawUsers.find(x => x.id === btn.dataset.editUser);
      if (u) openEditUserModal(u);
    });
  });

  // Attach Delete User handlers
  tbody.querySelectorAll("[data-delete-user]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDeleteUserModal(btn.dataset.deleteUser, btn.dataset.name);
    });
  });
}

function openEditUserModal(u) {
  const orgOptions = rawOrgs.map(o => \`<option value="\${o.id}" \${u.organization_id === o.id ? 'selected' : ''}>\${escapeHtml(o.name)}</option>\`).join("");

  showModal({
    title: \`Edit User: \${u.full_name}\`,
    bodyHtml: \`
      <div class="field">
        <label for="edit-user-name">Full Name *</label>
        <input type="text" id="edit-user-name" value="\${escapeHtml(u.full_name)}" required>
      </div>
      <div class="field">
        <label for="edit-user-email">Email Address *</label>
        <input type="email" id="edit-user-email" value="\${escapeHtml(u.email)}" required>
      </div>
      <div class="field">
        <label for="edit-user-role">Platform Role</label>
        <select id="edit-user-role">
          <option value="member" \${u.role === 'member' ? 'selected' : ''}>Member (Voter)</option>
          <option value="candidate" \${u.role === 'candidate' ? 'selected' : ''}>Candidate</option>
          <option value="org_admin" \${u.role === 'org_admin' ? 'selected' : ''}>Organization Admin</option>
          <option value="super_admin" \${u.role === 'super_admin' ? 'selected' : ''}>Platform Super Admin</option>
        </select>
      </div>
      <div class="field" id="edit-user-org-wrap">
        <label for="edit-user-org">Assigned Organization</label>
        <select id="edit-user-org">
          <option value="">-- None (Super Admin only) --</option>
          \${orgOptions}
        </select>
      </div>
      <div class="field">
        <label for="edit-user-pw">Reset Password (leave blank to keep current)</label>
        <input type="password" id="edit-user-pw" placeholder="New password (min 8 characters)">
      </div>
    \`,
    confirmText: "Save Changes",
    onConfirm: async () => {
      const full_name = document.getElementById("edit-user-name").value.trim();
      const email = document.getElementById("edit-user-email").value.trim();
      const role = document.getElementById("edit-user-role").value;
      const orgId = document.getElementById("edit-user-org").value || null;
      const password = document.getElementById("edit-user-pw").value;

      if (!full_name || !email) throw new Error("Full name and email are required.");
      if (password && password.length < 8) throw new Error("Password must be at least 8 characters.");

      await api("PATCH", \`/superadmin/users/\${u.id}\`, {
        full_name, email, role,
        organization_id: role === "super_admin" ? null : orgId,
        password: password || undefined,
      });

      showToast("User updated successfully!", "success");
      await loadData();
    }
  });
}

function openDeleteUserModal(userId, userName) {
  showModal({
    title: "Delete User Account",
    bodyHtml: \`
      <div class="alert alert-error" style="margin-bottom:14px">
        <strong>Warning:</strong> You are about to permanently delete account <strong>\${escapeHtml(userName)}</strong>.
      </div>
      <p class="meta">This action cannot be undone. Any cast ballots remain anonymous in the database.</p>
    \`,
    confirmText: "Delete Account",
    onConfirm: async () => {
      await api("DELETE", \`/superadmin/users/\${userId}\`);
      showToast(\`User "\${userName}" deleted\`, "success");
      await loadData();
    }
  });
}

// Add User / Admin Modal
document.getElementById("new-user-btn")?.addEventListener("click", () => {
  const orgOptions = rawOrgs.map(o => \`<option value="\${o.id}">\${escapeHtml(o.name)}</option>\`).join("");

  showModal({
    title: "Create User / Administrator",
    bodyHtml: \`
      <div class="field">
        <label for="nu-name">Full Name *</label>
        <input type="text" id="nu-name" placeholder="e.g. John Doe" required>
      </div>
      <div class="field">
        <label for="nu-email">Email Address *</label>
        <input type="email" id="nu-email" placeholder="user@organization.edu" required>
      </div>
      <div class="field">
        <label for="nu-role">Account Role *</label>
        <select id="nu-role">
          <option value="member">Member (Voter)</option>
          <option value="candidate">Candidate</option>
          <option value="org_admin">Organization Administrator</option>
          <option value="super_admin">Platform Super Administrator</option>
        </select>
      </div>
      <div class="field" id="nu-org-field">
        <label for="nu-org">Assigned Organization</label>
        <select id="nu-org">
          <option value="">-- Select an Organization --</option>
          \${orgOptions}
        </select>
      </div>
      <div class="field">
        <label for="nu-pw">Password * (min 8 characters)</label>
        <input type="password" id="nu-pw" placeholder="••••••••" required>
      </div>
    \`,
    confirmText: "Create Account",
    onConfirm: async () => {
      const full_name = document.getElementById("nu-name").value.trim();
      const email = document.getElementById("nu-email").value.trim();
      const role = document.getElementById("nu-role").value;
      const orgId = document.getElementById("nu-org").value || undefined;
      const password = document.getElementById("nu-pw").value;

      if (!full_name || !email || !password) throw new Error("Full name, email, and password are required.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (role !== "super_admin" && !orgId) throw new Error("Please select an organization for this user.");

      await api("POST", "/superadmin/users", {
        full_name, email, role,
        organization_id: role === "super_admin" ? undefined : orgId,
        password,
      });

      showToast(\`Account for \${full_name} created!\`, "success");
      await loadData();
    }
  });
});

// Edit Organization Modal
function openEditOrgModal(orgId, currentName, currentSlug) {
  showModal({
    title: \`Edit Organization: \${currentName}\`,
    bodyHtml: \`
      <div class="field">
        <label for="edit-org-name">Organization Name *</label>
        <input type="text" id="edit-org-name" value="\${escapeHtml(currentName)}" required>
      </div>
      <div class="field">
        <label for="edit-org-slug">URL Slug *</label>
        <input type="text" id="edit-org-slug" value="\${escapeHtml(currentSlug)}" required>
        <div class="hint">Url-friendly identifier, e.g. "mru-guild"</div>
      </div>
    \`,
    confirmText: "Update Organization",
    onConfirm: async () => {
      const name = document.getElementById("edit-org-name").value.trim();
      const slug = document.getElementById("edit-org-slug").value.trim();
      if (!name) throw new Error("Organization name is required.");

      await api("PATCH", \`/superadmin/organizations/\${orgId}\`, { name, slug });
      showToast("Organization updated successfully!", "success");
      await loadData();
    }
  });
}

// Delete Organization Modal
function openDeleteOrgModal(orgId, orgName) {
  showModal({
    title: "Delete Organization",
    bodyHtml: \`
      <div class="alert alert-error" style="margin-bottom:14px">
        <strong>Danger:</strong> You are about to permanently delete <strong>\${escapeHtml(orgName)}</strong>.
      </div>
      <p class="meta">This will delete all elections, candidate records, member accounts, and ballot data for this tenant. This action is irreversible.</p>
    \`,
    confirmText: "Delete Organization",
    onConfirm: async () => {
      await api("DELETE", \`/superadmin/organizations/\${orgId}\`);
      showToast(\`Organization "\${orgName}" deleted.\`, "success");
      await loadData();
    }
  });
}

// Attach Edit/Delete Org listeners in renderOrgsTable
const origRenderOrgsTable = renderOrgsTable;
renderOrgsTable = function() {
  origRenderOrgsTable();
  const tbody = document.getElementById("orgs-body");
  if (!tbody) return;

  tbody.querySelectorAll("[data-edit-org]").forEach(btn => {
    btn.addEventListener("click", () => {
      openEditOrgModal(btn.dataset.editOrg, btn.dataset.name, btn.dataset.slug);
    });
  });

  tbody.querySelectorAll("[data-delete-org]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDeleteOrgModal(btn.dataset.deleteOrg, btn.dataset.name);
    });
  });
};

// User filter listeners
document.getElementById("user-search")?.addEventListener("input", renderUsersTable);
document.querySelectorAll("[data-user-filter]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-user-filter]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentUserFilter = btn.dataset.userFilter;
    renderUsersTable();
  });
});

`;

if (src.includes(beforeLoadData)) {
  src = src.replace(beforeLoadData, newCrudFunctions + beforeLoadData);
  console.log('User CRUD and Org CRUD functions attached before loadData().');
}

fs.writeFileSync('public/superadmin/dashboard.html', src, 'utf8');
console.log('public/superadmin/dashboard.html updated successfully.');
