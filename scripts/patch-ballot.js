const fs = require('fs');
let src = fs.readFileSync('public/voter/ballot.html', 'utf8');

const renderStart = src.indexOf('\nfunction render() {');
const renderEnd = src.indexOf('\nfunction openConfirmModal()');

if (renderStart === -1 || renderEnd === -1) {
  console.error('Could not find render() function boundaries. renderStart:', renderStart, 'renderEnd:', renderEnd);
  process.exit(1);
}

const newRender = `
function render() {
  if (!currentCandidates.length) {
    document.getElementById('content').innerHTML = \`
      <div class="page-head">
        <div>
          <h1>\${escapeHtml(currentElection.title)}</h1>
          <p class="meta">\${escapeHtml(currentElection.position_name)}</p>
        </div>
      </div>
      <div class="empty-state">
        <h3>No candidates on this ballot</h3>
        <p class="meta">The election administrator has not approved any candidate applications yet.</p>
        <a class="btn btn-ghost" href="/voter/elections.html" style="margin-top:14px">&larr; Back to elections</a>
      </div>
    \`;
    return;
  }

  const cards = currentCandidates.map(c => {
    const hasPhoto = c.photo_url && c.photo_url.trim();
    const hasParty = c.party_name || c.party_symbol_url;
    const hasManifesto = c.manifesto && c.manifesto.trim();
    const mId = 'mf-' + c.candidate_application_id;

    const avatarHtml = hasPhoto
      ? '<img src="' + escapeHtml(c.photo_url) + '" alt="' + escapeHtml(c.candidate_name) + '" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid var(--glass-border);flex-shrink:0" onerror="this.style.display=\\'none\\'">'
      : '<div class="avatar-initials">' + getInitials(c.candidate_name) + '</div>';

    const partyHtml = hasParty
      ? '<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">'
          + (c.party_symbol_url ? '<img src="' + escapeHtml(c.party_symbol_url) + '" alt="party" style="width:22px;height:22px;border-radius:4px;object-fit:contain" onerror="this.style.display=\\'none\\'">' : '')
          + (c.party_name ? '<span style="font-size:0.78rem;font-weight:700;color:var(--neon-amber);letter-spacing:0.04em;text-transform:uppercase">' + escapeHtml(c.party_name) + '</span>' : '')
          + '</div>'
      : '';

    const manifestoHtml = hasManifesto
      ? '<div style="margin-top:8px" onclick="event.stopPropagation()">'
          + '<button type="button" onclick="toggleManifesto(\'' + mId + '\')" style="background:none;border:none;color:var(--neon-cyan);font-size:0.82rem;font-weight:600;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:5px">'
          + '<span id="' + mId + '-icon">&#9654;</span> View Full Manifesto'
          + '</button>'
          + '<div id="' + mId + '" style="display:none;margin-top:8px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:10px;font-size:0.85rem;line-height:1.65;color:var(--text-body);white-space:pre-wrap">' + escapeHtml(c.manifesto) + '</div>'
          + '</div>'
      : '';

    return '<div class="ballot-card" data-id="' + c.candidate_application_id + '" data-name="' + escapeHtml(c.candidate_name) + '">'
        + '<div class="ballot-radio"></div>'
        + avatarHtml
        + '<div style="flex:1;min-width:0">'
        + partyHtml
        + '<h3 style="margin:0 0 4px;font-size:1.1rem">' + escapeHtml(c.candidate_name) + '</h3>'
        + (c.statement
            ? '<p class="meta" style="margin:0;font-size:0.88rem;color:var(--text-muted);line-height:1.4">&quot;' + escapeHtml(c.statement) + '&quot;</p>'
            : '<p class="meta" style="margin:0;font-style:italic">No candidate statement provided.</p>')
        + manifestoHtml
        + '</div>'
        + '</div>';
  }).join('');

  document.getElementById('content').innerHTML = \`
    <div class="page-head" style="margin-bottom:18px">
      <div>
        <span class="badge badge-approved" style="margin-bottom:6px"><span class="badge-dot"></span> Secret Ballot</span>
        <h1 style="margin:4px 0">\${escapeHtml(currentElection.title)}</h1>
        <p class="meta">Voting for: <strong>\${escapeHtml(currentElection.position_name)}</strong></p>
      </div>
    </div>
    <div class="panel-plain" style="margin-bottom:20px;background:var(--glass-bg-card);font-size:0.86rem;color:var(--text-muted)">
      <strong>Voting instructions:</strong> Select exactly one candidate below and click "Review &amp; Cast Ballot". Your vote will be recorded with total anonymity.
    </div>
    <div id="ballot-list">\${cards}</div>
    <div style="margin-top:24px">
      <button class="btn btn-primary btn-block" id="review-btn" disabled style="padding:14px;font-size:1.05rem">Select a candidate above</button>
    </div>
  \`;

  document.querySelectorAll('.ballot-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.ballot-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCandidate = { id: card.dataset.id, name: card.dataset.name };
      const btn = document.getElementById('review-btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Review vote for ' + selectedCandidate.name + ' \u2192';
        btn.className = 'btn btn-gold btn-block';
      }
    });
  });

  const reviewBtn = document.getElementById('review-btn');
  if (reviewBtn) { reviewBtn.addEventListener('click', openConfirmModal); }
}

function toggleManifesto(id) {
  const el = document.getElementById(id);
  const icon = document.getElementById(id + '-icon');
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (icon) icon.innerHTML = open ? '&#9660;' : '&#9654;';
}

`;

const newSrc = src.slice(0, renderStart) + newRender + src.slice(renderEnd);
fs.writeFileSync('public/voter/ballot.html', newSrc, 'utf8');
console.log('ballot.html render() patched successfully. New length:', newSrc.length);
