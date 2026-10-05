const fs = require('fs');
let src = fs.readFileSync('public/orgadmin/roster.html', 'utf8');

// 1. Add + Add Member button to page-actions
const oldActions = `    <div class="page-actions">
      <button class="btn btn-ghost btn-sm" id="export-roster-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export Roster (CSV)
      </button>
    </div>`;

const newActions = `    <div class="page-actions">
      <button class="btn btn-ghost btn-sm" id="export-roster-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export Roster (CSV)
      </button>
      <button class="btn btn-primary btn-sm" id="new-member-btn">+ Add Member</button>
    </div>`;

if (src.includes(oldActions)) {
  src = src.replace(oldActions, newActions);
  console.log('Page actions updated with Add Member button.');
}

// 2. Add Actions column to table thead
const oldThead = `        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Standing Role</th>
          <th>Verification</th>
          <th>Approved Candidacies</th>
          <th>Joined</th>
        </tr>`;

const newThead = `        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Standing Role</th>
          <th>Verification</th>
          <th>Approved Candidacies</th>
          <th>Joined</th>
          <th style="text-align:right">Actions</th>
        </tr>`;

if (src.includes(oldThead)) {
  src = src.replace(oldThead, newThead);
  console.log('Thead updated with Actions column.');
}

// 3. Update empty state and rows in render()
const oldEmpty = `<td colspan="6" class="empty-state">`;
const newEmpty = `<td colspan="7" class="empty-state">`;
src = src.replaceAll(oldEmpty, newEmpty);

const oldRowEnd = `      <td>
        <strong>\${r.approved_candidacies}</strong> election(s)
      </td>
      <td class="meta">\${fmtDate(r.created_at)}</td>
    </tr>`;

const newRowEnd = `      <td>
        <strong>\${r.approved_candidacies}</strong> election(s)
      </td>
      <td class="meta">\${fmtDate(r.created_at)}</td>
      <td style="text-align:right">
        <div style="display:inline-flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-sm btn-ghost" data-edit-member="\${r.id}">Edit</button>
          \${r.id !== user.id ? \`<button class="btn btn-sm btn-danger" data-delete-member="\${r.id}" data-name="\${escapeHtml(r.full_name)}">Remove</button>\` : '<span class="meta" style="font-size:0.75rem;padding:4px">(You)</span>'}
        </div>
      </td>
    </tr>`;

if (src.includes(oldRowEnd)) {
  src = src.replace(oldRowEnd, newRowEnd);
  console.log('Row rendering updated with Edit and Remove buttons.');
}

// 4. Attach event listeners for Add, Edit, Remove before load()
const beforeLoad = `load();`;
const memberCrudFunctions = `
// ---------------- Member CRUD Handlers
function attachRosterActionListeners() {
  const tbody = document.getElementById("roster-body");
  if (!tbody) return;

  tbody.querySelectorAll("[data-edit-member]").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = roster.find(x => x.id === btn.dataset.editMember);
      if (m) openEditMemberModal(m);
    });
  });

  tbody.querySelectorAll("[data-delete-member]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDeleteMemberModal(btn.dataset.deleteMember, btn.dataset.name);
    });
  });
}

function openAddMemberModal() {
  showModal({
    title: "Add Organization Member",
    bodyHtml: \`
      <div class="field">
        <label for="nm-name">Full Name *</label>
        <input type="text" id="nm-name" placeholder="e.g. Grace Nakato" required>
      </div>
      <div class="field">
        <label for="nm-email">Email Address *</label>
        <input type="email" id="nm-email" placeholder="grace@institution.edu" required>
      </div>
      <div class="field">
        <label for="nm-role">Role *</label>
        <select id="nm-role">
          <option value="member">Standard Member (Voter)</option>
          <option value="candidate">Candidate</option>
          <option value="org_admin">Organization Co-Admin</option>
        </select>
      </div>
      <div class="field">
        <label for="nm-pw">Temporary Password * (min 8 characters)</label>
        <input type="password" id="nm-pw" placeholder="••••••••" required>
      </div>
    \`,
    confirmText: "Add Member",
    onConfirm: async () => {
      const full_name = document.getElementById("nm-name").value.trim();
      const email = document.getElementById("nm-email").value.trim();
      const role = document.getElementById("nm-role").value;
      const password = document.getElementById("nm-pw").value;

      if (!full_name || !email || !password) throw new Error("Full name, email, and password are required.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");

      await api("POST", "/orgadmin/members", { full_name, email, role, password });
      showToast(\`Member \${full_name} added to roster!\`, "success");
      await load();
    }
  });
}

function openEditMemberModal(m) {
  showModal({
    title: \`Edit Member: \${m.full_name}\`,
    bodyHtml: \`
      <div class="field">
        <label for="em-name">Full Name *</label>
        <input type="text" id="em-name" value="\${escapeHtml(m.full_name)}" required>
      </div>
      <div class="field">
        <label for="em-email">Email Address *</label>
        <input type="email" id="em-email" value="\${escapeHtml(m.email)}" required>
      </div>
      <div class="field">
        <label for="em-role">Standing Role</label>
        <select id="em-role">
          <option value="member" \${m.role === 'member' ? 'selected' : ''}>Standard Member (Voter)</option>
          <option value="candidate" \${m.role === 'candidate' ? 'selected' : ''}>Candidate</option>
          <option value="org_admin" \${m.role === 'org_admin' ? 'selected' : ''}>Organization Co-Admin</option>
        </select>
      </div>
      <div class="field">
        <label for="em-pw">Reset Password (optional)</label>
        <input type="password" id="em-pw" placeholder="Leave blank to keep existing password">
      </div>
    \`,
    confirmText: "Save Changes",
    onConfirm: async () => {
      const full_name = document.getElementById("em-name").value.trim();
      const email = document.getElementById("em-email").value.trim();
      const role = document.getElementById("em-role").value;
      const password = document.getElementById("em-pw").value;

      if (!full_name || !email) throw new Error("Full name and email are required.");
      if (password && password.length < 8) throw new Error("Password must be at least 8 characters.");

      await api("PATCH", \`/orgadmin/members/\${m.id}\`, {
        full_name, email, role,
        password: password || undefined,
      });

      showToast("Member updated successfully!", "success");
      await load();
    }
  });
}

function openDeleteMemberModal(memberId, memberName) {
  showModal({
    title: "Remove Member",
    bodyHtml: \`
      <div class="alert alert-error" style="margin-bottom:14px">
        <strong>Confirm Removal:</strong> Are you sure you want to remove <strong>\${escapeHtml(memberName)}</strong> from the organization?
      </div>
      <p class="meta">Their voting credentials will be deactivated. Historical ballot marks remain anonymous.</p>
    \`,
    confirmText: "Remove Member",
    onConfirm: async () => {
      await api("DELETE", \`/orgadmin/members/\${memberId}\`);
      showToast(\`Member "\${memberName}" removed.\`, "success");
      await load();
    }
  });
}

// Hook attachRosterActionListeners into render()
const origRosterRender = render;
render = function() {
  origRosterRender();
  attachRosterActionListeners();
};

document.getElementById("new-member-btn")?.addEventListener("click", openAddMemberModal);

`;

if (src.includes(beforeLoad)) {
  src = src.replace(beforeLoad, memberCrudFunctions + beforeLoad);
  console.log('Member CRUD functions attached.');
}

fs.writeFileSync('public/orgadmin/roster.html', src, 'utf8');
console.log('public/orgadmin/roster.html updated successfully.');
