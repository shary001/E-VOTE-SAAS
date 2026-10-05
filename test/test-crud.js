require('dotenv').config();
const { pool } = require('../server/db');

const BASE = 'http://localhost:3000';

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

(async () => {
  console.log('--- Testing Full CRUD for Admins ---');
  let pass = 0, fail = 0;
  function check(label, cond) {
    if (cond) { pass++; console.log(`  OK   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}`); }
  }

  // 1. Super Admin login
  const saLogin = await api('POST', '/api/auth/login', {
    email: 'superadmin@example.com',
    password: 'ChangeMe123!',
  });
  const saToken = saLogin.body?.token;
  check('Super Admin login successful', saLogin.status === 200 && !!saToken);

  // 2. Super Admin Organization CRUD
  // Create
  const testSlug = `crud-org-${Date.now()}`;
  const orgCreate = await api('POST', '/api/superadmin/organizations', {
    name: 'CRUD Test Org',
    slug: testSlug,
    admin_name: 'Test Org Admin',
    admin_email: `orgadmin-${Date.now()}@example.com`,
    admin_password: 'Password123!',
  }, saToken);
  const testOrgId = orgCreate.body?.organization?.id;
  const orgAdminEmail = orgCreate.body?.admin?.email;
  check('Super Admin created org', orgCreate.status === 201 && !!testOrgId);

  // Read single
  const orgGet = await api('GET', `/api/superadmin/organizations/${testOrgId}`, null, saToken);
  check('Super Admin read single org', orgGet.status === 200 && orgGet.body?.name === 'CRUD Test Org');

  // Update
  const orgPatch = await api('PATCH', `/api/superadmin/organizations/${testOrgId}`, {
    name: 'CRUD Test Org Updated',
  }, saToken);
  check('Super Admin updated org name', orgPatch.status === 200 && orgPatch.body?.name === 'CRUD Test Org Updated');

  // 3. Super Admin Users CRUD
  // Create user
  const testUserEmail = `crud-user-${Date.now()}@example.com`;
  const userCreate = await api('POST', '/api/superadmin/users', {
    full_name: 'CRUD Test User',
    email: testUserEmail,
    password: 'Password123!',
    role: 'member',
    organization_id: testOrgId,
  }, saToken);
  const testUserId = userCreate.body?.id;
  check('Super Admin created user', userCreate.status === 201 && !!testUserId);

  // Read users list
  const usersList = await api('GET', `/api/superadmin/users?organization_id=${testOrgId}`, null, saToken);
  check('Super Admin read users list', usersList.status === 200 && Array.isArray(usersList.body) && usersList.body.length >= 2);

  // Update user
  const userPatch = await api('PATCH', `/api/superadmin/users/${testUserId}`, {
    full_name: 'CRUD Test User Renamed',
    role: 'candidate',
  }, saToken);
  check('Super Admin updated user', userPatch.status === 200 && userPatch.body?.full_name === 'CRUD Test User Renamed' && userPatch.body?.role === 'candidate');

  // Delete user
  const userDelete = await api('DELETE', `/api/superadmin/users/${testUserId}`, null, saToken);
  check('Super Admin deleted user', userDelete.status === 200);

  // 4. Org Admin Members CRUD
  // Org Admin login
  const oaLogin = await api('POST', '/api/auth/login', {
    email: orgAdminEmail,
    password: 'Password123!',
  });
  const oaToken = oaLogin.body?.token;
  check('Org Admin logged in', oaLogin.status === 200 && !!oaToken);

  // Create member
  const memberEmail = `member-${Date.now()}@example.com`;
  const memberCreate = await api('POST', '/api/orgadmin/members', {
    full_name: 'Org Member One',
    email: memberEmail,
    password: 'Password123!',
    role: 'member',
  }, oaToken);
  const memberId = memberCreate.body?.id;
  check('Org Admin created member', memberCreate.status === 201 && !!memberId);

  // Read roster
  const rosterGet = await api('GET', '/api/orgadmin/roster', null, oaToken);
  check('Org Admin read roster', rosterGet.status === 200 && rosterGet.body.some(m => m.id === memberId));

  // Update member
  const memberPatch = await api('PATCH', `/api/orgadmin/members/${memberId}`, {
    full_name: 'Org Member One Updated',
    role: 'candidate',
  }, oaToken);
  check('Org Admin updated member', memberPatch.status === 200 && memberPatch.body?.role === 'candidate');

  // Delete member
  const memberDelete = await api('DELETE', `/api/orgadmin/members/${memberId}`, null, oaToken);
  check('Org Admin deleted member', memberDelete.status === 200);

  // 5. Org Admin Election CRUD (Create + Delete)
  const now = new Date();
  const tAppOpen = new Date(now.getTime() + 1000 * 3600);
  const tAppClose = new Date(now.getTime() + 2000 * 3600);
  const tVoteOpen = new Date(now.getTime() + 3000 * 3600);
  const tVoteClose = new Date(now.getTime() + 4000 * 3600);

  const elecCreate = await api('POST', '/api/elections', {
    title: 'Test Deletable Election',
    position_name: 'Chairperson',
    application_open_at: tAppOpen.toISOString(),
    application_close_at: tAppClose.toISOString(),
    voting_open_at: tVoteOpen.toISOString(),
    voting_close_at: tVoteClose.toISOString(),
  }, oaToken);
  const testElecId = elecCreate.body?.id;
  check('Org Admin created draft election', elecCreate.status === 201 && !!testElecId);

  // Delete election
  const elecDelete = await api('DELETE', `/api/elections/${testElecId}`, null, oaToken);
  check('Org Admin deleted draft election', elecDelete.status === 200);

  // 6. Super Admin delete organization (clean up)
  const orgDelete = await api('DELETE', `/api/superadmin/organizations/${testOrgId}`, null, saToken);
  check('Super Admin deleted organization (cascade)', orgDelete.status === 200);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
