const fs = require('fs');
let src = fs.readFileSync('public/results.html', 'utf8');

// Patch 1: Add photo + party to winner banner
const oldWinnerBanner = `      <div class="winner-banner">
        <div>
          <div class="winner-badge">★ Projected Winner</div>
          <h2 class="winner-name">\${escapeHtml(winner.candidate_name)}</h2>
          <p class="meta" style="margin:0">
            Received <strong>\${winner.vote_count}</strong> votes (\${winnerShare}% of total votes)
          </p>
          \${winner.statement ? \`<p class="meta" style="margin-top:8px;font-style:italic">"\${escapeHtml(winner.statement)}"\` : ""}
        </div>
        <div style="flex-shrink:0">
          <div class="winner-tally">\${winner.vote_count}</div>
          <span class="meta" style="display:block;text-align:right">Ballots Counted</span>
        </div>
      </div>`;

const newWinnerBanner = `      <div class="winner-banner">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          \${winner.photo_url ? \`<img src="\${escapeHtml(winner.photo_url)}" alt="\${escapeHtml(winner.candidate_name)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(168,85,247,0.6);flex-shrink:0" onerror="this.style.display='none'">\` : ''}
          <div>
            <div class="winner-badge">★ Projected Winner</div>
            \${winner.party_name ? \`<div style="font-size:0.8rem;font-weight:700;color:var(--neon-amber);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px">\${escapeHtml(winner.party_name)}</div>\` : ''}
            <h2 class="winner-name">\${escapeHtml(winner.candidate_name)}</h2>
            <p class="meta" style="margin:0">
              Received <strong>\${winner.vote_count}</strong> votes (\${winnerShare}% of total votes)
            </p>
            \${winner.statement ? \`<p class="meta" style="margin-top:8px;font-style:italic">"\${escapeHtml(winner.statement)}"</p>\` : ""}
          </div>
        </div>
        <div style="flex-shrink:0">
          <div class="winner-tally">\${winner.vote_count}</div>
          <span class="meta" style="display:block;text-align:right">Ballots Counted</span>
        </div>
      </div>`;

// Patch 2: Add photo + party + manifesto to candidate breakdown cards
const oldCandCard = `          <div class="candidate-row-card \${isWinner ? 'is-winner' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
              <div>
                <span class="meta" style="font-weight:700">#\${idx + 1}</span>
                <strong style="font-size:1.15rem;margin-left:6px">\${escapeHtml(c.candidate_name)}</strong>
                \${isWinner ? \`<span class="badge badge-approved" style="margin-left:8px">Winner</span>\` : ""}
                \${c.statement ? \`<p class="meta" style="margin:6px 0 0">\${escapeHtml(c.statement)}</p>\` : ""}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <span style="font-family:var(--sans);font-size:1.5rem;font-weight:700;color:var(--neon-emerald)">
                  \${c.vote_count}
                </span>
                <span class="meta" style="display:block">\${pct}%</span>
              </div>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:\${(c.vote_count / maxVotes) * 100}%"></div>
            </div>
          </div>`;

const newCandCard = `          <div class="candidate-row-card \${isWinner ? 'is-winner' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
              <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0">
                \${c.photo_url ? \`<img src="\${escapeHtml(c.photo_url)}" alt="\${escapeHtml(c.candidate_name)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--glass-border);flex-shrink:0;margin-top:2px" onerror="this.style.display='none'">\` : ''}
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span class="meta" style="font-weight:700">#\${idx + 1}</span>
                    <strong style="font-size:1.1rem">\${escapeHtml(c.candidate_name)}</strong>
                    \${isWinner ? \`<span class="badge badge-approved">Winner</span>\` : ""}
                  </div>
                  \${(c.party_name || c.party_symbol_url) ? \`<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    \${c.party_symbol_url ? \`<img src="\${escapeHtml(c.party_symbol_url)}" alt="party" style="width:18px;height:18px;border-radius:3px;object-fit:contain" onerror="this.style.display='none'">\` : ''}
                    \${c.party_name ? \`<span style="font-size:0.76rem;font-weight:700;color:var(--neon-amber);letter-spacing:0.04em;text-transform:uppercase">\${escapeHtml(c.party_name)}</span>\` : ''}
                  </div>\` : ''}
                  \${c.statement ? \`<p class="meta" style="margin:5px 0 0;font-size:0.87rem">\${escapeHtml(c.statement)}</p>\` : ""}
                </div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <span style="font-family:var(--sans);font-size:1.5rem;font-weight:700;color:var(--neon-emerald)">\${c.vote_count}</span>
                <span class="meta" style="display:block">\${pct}%</span>
              </div>
            </div>
            <div class="bar-track" style="margin-top:10px">
              <div class="bar-fill" style="width:\${(c.vote_count / maxVotes) * 100}%"></div>
            </div>
          </div>`;

if (!src.includes(oldWinnerBanner.slice(0, 60))) {
  console.warn('Warning: winner banner target snippet not found exactly. Skipping winner banner patch.');
} else {
  src = src.replace(oldWinnerBanner, newWinnerBanner);
  console.log('Winner banner patched.');
}

if (!src.includes(oldCandCard.slice(0, 60))) {
  console.warn('Warning: candidate card target snippet not found exactly. Skipping candidate card patch.');
} else {
  src = src.replace(oldCandCard, newCandCard);
  console.log('Candidate card patched.');
}

fs.writeFileSync('public/results.html', src, 'utf8');
console.log('results.html updated. Length:', src.length);
