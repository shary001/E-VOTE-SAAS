// Checks the *automated* half of an election's eligibility_rules against a
// user. Returns { eligible: boolean, reasons: string[] }.
//
// eligibility_rules shape:
//   { min_account_age_days: number, allowed_departments: string[], criteria_text: string }
//
// allowed_departments matches against the free-text `department` field a user
// can optionally supply on their application (see candidates.js) — an empty
// array means no department restriction. criteria_text is NOT auto-checked;
// it's shown to the org_admin as a manual checklist item when they review.
function evaluateEligibility(rules, user, applicationDepartment) {
  const reasons = [];
  const r = rules || {};

  const minDays = Number(r.min_account_age_days || 0);
  if (minDays > 0) {
    const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
    if (ageDays < minDays) {
      reasons.push(`Account must be at least ${minDays} day(s) old (currently ${Math.floor(ageDays)}).`);
    }
  }

  const allowedDepts = Array.isArray(r.allowed_departments) ? r.allowed_departments.filter(Boolean) : [];
  if (allowedDepts.length > 0) {
    if (!applicationDepartment || !allowedDepts.map(d => d.toLowerCase()).includes(applicationDepartment.toLowerCase())) {
      reasons.push(`Department must be one of: ${allowedDepts.join(", ")}.`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

module.exports = { evaluateEligibility };
