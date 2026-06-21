/* ============================================================
   ranking.js — Agent Level & Ranking System
   ------------------------------------------------------------
   Data model (lives inside the existing shared state, so it
   syncs through the same Drive backend as everything else —
   no new storage wiring needed):

   state.levelDefs = [
     { id, order, name, rankName, targetPct, allocationLimit, benefits: [string,...] }
   ]
   — Admin/Dev defined. `order` controls the ladder position
     (lowest order = entry level). `targetPct` is the progress
     percentage required to be ELIGIBLE for that level (kept on
     the level you're upgrading INTO, so the ladder reads top
     to bottom as "harder to reach").

   Each agentState[i] additionally carries:
     allocatedAmount   — the lending target this agent is judged against
     levelId           — id of their current level (or '' = unranked/base)
     upgradeRequest     — { levelId, requestedAt, verifyUntil, status }
                          status: 'verifying' | 'pending_admin' | null

   Progress formula (per spec):
     progress% = (fully settled loan amount ÷ allocated amount) × 100
     "Fully settled" = loans with status === 'Paid', summed by l.amount
     (the original principal of that loan, since the spec's example
     uses the loan's full amount once settled — not the partial
     principal repaid against an open loan).
   ============================================================ */

const RANK_VERIFY_HOURS = 24;          // verification countdown length
const RANK_UPGRADE_THRESHOLD = 65;     // % progress required to unlock upgrade requests

/* ---------------- CORE CALCULATIONS ---------------- */

function getAgentAllocated(agent) {
    return Number(agent?.allocatedAmount) || 0;
}

function getAgentSettledAmount(agentId) {
    return state.loans
        .filter(l => l.agentId === agentId && l.status === 'Paid')
        .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
}

function getAgentProgressPct(agent) {
    const allocated = getAgentAllocated(agent);
    if (!allocated) return 0;
    const settled = getAgentSettledAmount(agent.id);
    return Math.min(100, round2((settled / allocated) * 100));
}

function sortedLevelDefs() {
    return [...(state.levelDefs || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getLevelById(id) {
    return (state.levelDefs || []).find(lv => lv.id === id) || null;
}

function getAgentCurrentLevel(agent) {
    return agent?.levelId ? getLevelById(agent.levelId) : null;
}

// The next level on the ladder above the agent's current one.
function getNextLevel(agent) {
    const levels = sortedLevelDefs();
    if (!levels.length) return null;
    const current = getAgentCurrentLevel(agent);
    if (!current) return levels[0];
    const idx = levels.findIndex(lv => lv.id === current.id);
    return idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
}

function isUpgradeUnlocked(agent) {
    return getAgentProgressPct(agent) >= RANK_UPGRADE_THRESHOLD && !!getNextLevel(agent);
}

/* ---------------- LEADERBOARD ---------------- */

function buildLeaderboard() {
    return agentState
        .filter(a => !a.disabled)
        .map(a => ({
            agent: a,
            pct: getAgentProgressPct(a),
            settled: getAgentSettledAmount(a.id),
            allocated: getAgentAllocated(a),
            level: getAgentCurrentLevel(a)
        }))
        .sort((x, y) => y.pct - x.pct);
}

/* ============================================================
   ADMIN / DEV — Level & Rank management
   ============================================================ */

function renderLevelsAdminPage() {
    const root = document.getElementById('levelsAdminGrid');
    if (!root) return;
    const levels = sortedLevelDefs();
    if (!levels.length) {
        root.innerHTML = '<p class="empty-row">No levels created yet. Click "New Level" to define your first rank.</p>';
        return;
    }
    root.innerHTML = levels.map(lv => `
        <div class="level-card">
            <div class="level-card-head">
                <div>
                    <h4>${escapeHTML(lv.name)}</h4>
                    <small>${escapeHTML(lv.rankName || '—')}</small>
                </div>
                <span class="level-order-pill">#${lv.order}</span>
            </div>
            <div class="level-card-stats">
                <div><small>Target</small><strong>${lv.targetPct}%</strong></div>
                <div><small>Allocation Limit</small><strong>${fmtINR(lv.allocationLimit)}</strong></div>
            </div>
            ${lv.benefits && lv.benefits.length ? `<div class="benefit-chip-list">${lv.benefits.map(b => `<span class="benefit-chip"><i class="fa-solid fa-check"></i>${escapeHTML(b)}</span>`).join('')}</div>` : '<p class="muted-text" style="margin-top:12px;font-size:12px;">No benefits listed.</p>'}
            <div class="level-card-actions">
                <button class="btn-friendly-secondary compact" data-edit-level="${lv.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="row-action-btn" data-delete-level="${lv.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join('');
    root.querySelectorAll('[data-edit-level]').forEach(b => b.onclick = () => showLevelFormModal(b.dataset.editLevel));
    root.querySelectorAll('[data-delete-level]').forEach(b => b.onclick = () => deleteLevelDef(b.dataset.deleteLevel));
}

// Lightweight benefits tag editor used inside the level form modal.
// showFormModal only supports plain inputs/selects, so the benefits
// list is managed as a small standalone widget appended after it opens.
function attachBenefitsEditor(container, initialBenefits) {
    let benefits = [...(initialBenefits || [])];
    container.innerHTML = `
        <label class="modal-field-label">Benefits</label>
        <div class="benefit-tag-input-row">
            <input type="text" id="benefitDraftInput" placeholder="e.g. Lower interest approval limit">
            <button type="button" class="btn-friendly-secondary compact" id="benefitAddBtn"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
        <div class="benefit-tag-list" id="benefitTagList"></div>
    `;
    const list = container.querySelector('#benefitTagList');
    const input = container.querySelector('#benefitDraftInput');
    const renderTags = () => {
        list.innerHTML = benefits.map((b, i) => `<span class="benefit-tag">${escapeHTML(b)}<button type="button" data-remove-benefit="${i}"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
        list.querySelectorAll('[data-remove-benefit]').forEach(btn => btn.onclick = () => {
            benefits.splice(Number(btn.dataset.removeBenefit), 1);
            renderTags();
        });
    };
    const addBenefit = () => {
        const v = input.value.trim();
        if (!v) return;
        benefits.push(v);
        input.value = '';
        renderTags();
        input.focus();
    };
    container.querySelector('#benefitAddBtn').onclick = addBenefit;
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addBenefit(); }
    });
    renderTags();
    return () => benefits; // getter so the caller can read current benefits at submit time
}

function showLevelFormModal(levelId) {
    const existing = levelId ? getLevelById(levelId) : null;
    const levels = sortedLevelDefs();
    const nextOrder = existing ? existing.order : (levels.length ? Math.max(...levels.map(l => l.order || 0)) + 1 : 1);

    showFormModal({
        title: existing ? `Edit ${existing.name}` : 'New Level',
        icon: 'fa-ranking-star',
        submitLabel: existing ? 'Save Changes' : 'Create Level',
        wide: true,
        intro: 'Define the ladder position, the progress % an agent must reach to unlock this level, and what it unlocks.',
        fields: [
            { id: 'name', label: 'Level Name', required: true, placeholder: 'e.g. Level 2', value: existing?.name || '' },
            { id: 'rankName', label: 'Rank Name', required: true, placeholder: 'e.g. Silver Agent', value: existing?.rankName || '' },
            { id: 'order', label: 'Ladder Position', type: 'number', required: true, min: 1, step: '1', value: nextOrder, help: 'Lower numbers come first on the ladder (1 = entry level).' },
            { id: 'targetPct', label: 'Target Progress (%)', type: 'number', required: true, min: 1, max: 100, step: '1', value: existing?.targetPct ?? 65, help: 'Progress % an agent needs to reach to be eligible to upgrade into this level.' },
            { id: 'allocationLimit', label: 'Allocation Limit (₹)', type: 'number', required: true, min: 0, step: '0.01', value: existing?.allocationLimit ?? '', help: 'Maximum allocated amount an agent at this level can be given.' }
        ],
        onSubmit: (v) => {
            const order = Number(v.order), targetPct = Number(v.targetPct), allocationLimit = Number(v.allocationLimit);
            if (!v.name || !v.rankName) return showToast('Level name and rank name are required.', 'danger');
            if (!order || order < 1) return showToast('Ladder position must be 1 or higher.', 'danger');
            if (!targetPct || targetPct < 1 || targetPct > 100) return showToast('Target progress must be between 1 and 100.', 'danger');
            if (allocationLimit < 0 || isNaN(allocationLimit)) return showToast('Enter a valid allocation limit.', 'danger');

            const benefits = window._benefitsGetter ? window._benefitsGetter() : (existing?.benefits || []);
            if (existing) {
                existing.name = v.name; existing.rankName = v.rankName; existing.order = order;
                existing.targetPct = targetPct; existing.allocationLimit = allocationLimit; existing.benefits = benefits;
                addAudit('Level updated', `Level "${v.name}" updated`);
                showToast('Level updated.', 'success');
            } else {
                state.levelDefs = state.levelDefs || [];
                state.levelDefs.push({ id: genId('level'), name: v.name, rankName: v.rankName, order, targetPct, allocationLimit, benefits });
                addAudit('Level created', `Level "${v.name}" (${v.rankName}) created`);
                showToast('Level created.', 'success');
            }
            window._benefitsGetter = null;
            saveState();
            renderLevelsAdminPage();
            renderMyRankPage();
        }
    });

    // Append the benefits tag editor into the open modal, right after the field grid.
    setTimeout(() => {
        const grid = document.querySelector('#formModalOverlay .modal-fields-grid');
        if (!grid) return;
        const wrap = document.createElement('div');
        wrap.className = 'modal-field full';
        grid.appendChild(wrap);
        window._benefitsGetter = attachBenefitsEditor(wrap, existing?.benefits);
    }, 0);
}

function deleteLevelDef(id) {
    const lv = getLevelById(id);
    if (!lv) return;
    const inUse = agentState.some(a => a.levelId === id);
    if (inUse && !confirm(`"${lv.name}" is currently assigned to one or more agents. Delete it anyway? Those agents will become unranked.`)) return;
    if (!inUse && !confirm(`Delete level "${lv.name}"?`)) return;
    state.levelDefs = state.levelDefs.filter(l => l.id !== id);
    agentState.forEach(a => { if (a.levelId === id) a.levelId = ''; });
    addAudit('Level deleted', `Level "${lv.name}" deleted`);
    saveState();
    renderLevelsAdminPage();
    renderMyRankPage();
    showToast('Level deleted.', 'warning');
}

/* ---------------- ADMIN: per-agent allocation ---------------- */

function showSetAllocationModal(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;
    const level = getAgentCurrentLevel(a);
    showFormModal({
        title: `Set Allocated Amount — ${a.name}`,
        icon: 'fa-bullseye',
        submitLabel: 'Save Allocation',
        intro: level && level.allocationLimit ? `This agent's level ("${level.name}") caps allocation at ${fmtINR(level.allocationLimit)}.` : 'This is the lending target progress is measured against — separate from their cash fund.',
        fields: [
            { id: 'allocatedAmount', label: 'Allocated Amount (₹)', type: 'number', required: true, min: 0, step: '0.01', value: getAgentAllocated(a) }
        ],
        onSubmit: (v) => {
            const amt = Number(v.allocatedAmount);
            if (amt < 0 || isNaN(amt)) return showToast('Enter a valid amount.', 'danger');
            if (level && level.allocationLimit && amt > level.allocationLimit) return showToast(`Cannot exceed this agent's level limit of ${fmtINR(level.allocationLimit)}.`, 'danger');
            a.allocatedAmount = amt;
            addAudit('Allocation set', `Allocated amount for "${a.name}" set to ${fmtINR(amt)}`);
            saveState();
            renderAgentManager();
            renderLevelsAdminPage();
            showToast('Allocated amount updated.', 'success');
        }
    });
}

/* ---------------- ADMIN: upgrade request review ---------------- */

function renderUpgradeRequestsPanel() {
    const root = document.getElementById('upgradeRequestsList');
    if (!root) return;
    const requesting = agentState.filter(a => a.upgradeRequest && a.upgradeRequest.status);
    if (!requesting.length) {
        root.innerHTML = '<p class="empty-row">No upgrade requests right now.</p>';
        return;
    }
    root.innerHTML = requesting.map(a => {
        const req = a.upgradeRequest;
        const targetLevel = getLevelById(req.levelId);
        const verifying = req.status === 'verifying';
        const remainingMs = verifying ? req.verifyUntil - Date.now() : 0;
        return `
        <div class="request-row" data-request-row="${a.id}">
            <div class="request-row-info">
                <strong>${escapeHTML(a.name)} → ${escapeHTML(targetLevel?.name || 'Unknown level')}</strong>
                <small>Requested ${new Date(req.requestedAt).toLocaleString('en-IN')} · Progress at request: ${req.pctAtRequest}%</small>
                ${verifying ? `<small>Verification countdown: <span data-countdown="${a.id}">${formatCountdown(remainingMs)}</span></small>` : '<small style="color:var(--success);font-weight:700;">Verification complete — ready for approval</small>'}
            </div>
            <div class="request-row-actions">
                ${verifying ? '' : `<button class="btn-friendly-primary compact" data-approve="${a.id}"><i class="fa-solid fa-check"></i> Approve</button>`}
                <button class="btn-friendly-secondary compact" data-reject="${a.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
            </div>
        </div>`;
    }).join('');
    root.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => approveUpgradeRequest(b.dataset.approve));
    root.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => rejectUpgradeRequest(b.dataset.reject));
}

function approveUpgradeRequest(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a || !a.upgradeRequest) return;
    const req = a.upgradeRequest;
    if (req.status === 'verifying' && Date.now() < req.verifyUntil) {
        return showToast('Verification countdown has not finished yet.', 'warning');
    }
    const newLevel = getLevelById(req.levelId);
    if (!newLevel) return showToast('Target level no longer exists.', 'danger');

    a.levelId = newLevel.id;
    if (newLevel.allocationLimit && (!a.allocatedAmount || a.allocatedAmount < newLevel.allocationLimit)) {
        a.allocatedAmount = newLevel.allocationLimit;
    }
    a.upgradeRequest = null;
    addAudit('Upgrade approved', `${a.name} upgraded to "${newLevel.name}" (${newLevel.rankName})`);
    saveState();
    renderUpgradeRequestsPanel();
    renderAgentManager();
    renderMyRankPage();
    showToast(`${a.name} upgraded to ${newLevel.name}.`, 'success');
}

function rejectUpgradeRequest(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a || !a.upgradeRequest) return;
    if (!confirm(`Reject ${a.name}'s upgrade request?`)) return;
    const targetLevel = getLevelById(a.upgradeRequest.levelId);
    a.upgradeRequest = null;
    addAudit('Upgrade rejected', `${a.name}'s request to upgrade to "${targetLevel?.name || 'a level'}" was rejected`);
    saveState();
    renderUpgradeRequestsPanel();
    renderMyRankPage();
    showToast('Upgrade request rejected.', 'warning');
}

/* ============================================================
   AGENT — My Rank page
   ============================================================ */

let _rankCountdownTimer = null;

function formatCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function renderMyRankPage() {
    const isAgent = state.user?.role === 'agent';
    const isAdminOrDev = ['admin', 'developer'].includes(state.user?.role);

    if (isAgent) renderAgentRankCard();
    renderLeaderboard(document.getElementById('leaderboardList'));

    if (isAdminOrDev) {
        renderLevelsAdminPage();
        renderUpgradeRequestsPanel();
        renderLeaderboard(document.getElementById('leaderboardListAdmin'));
    }

    restartRankCountdownTicker();
}

function renderAgentRankCard() {
    const card = document.getElementById('myRankCard');
    if (!card) return;
    const a = agentState.find(x => x.id === state.user.agentId);
    if (!a) { card.innerHTML = '<p class="empty-row">Your agent record could not be found.</p>'; return; }

    const pct = getAgentProgressPct(a);
    const level = getAgentCurrentLevel(a);
    const nextLevel = getNextLevel(a);
    const allocated = getAgentAllocated(a);
    const settled = getAgentSettledAmount(a.id);
    const unlocked = isUpgradeUnlocked(a);
    const req = a.upgradeRequest;

    const markerHTML = nextLevel ? `<div class="progress-track-marker" style="left:${RANK_UPGRADE_THRESHOLD}%;" data-label="${RANK_UPGRADE_THRESHOLD}%"></div>` : '';

    let ctaHTML = '';
    if (req && req.status === 'verifying') {
        ctaHTML = `<div class="upgrade-status-banner"><div><strong>Upgrade request submitted</strong><small>Verifying eligibility for ${escapeHTML(getLevelById(req.levelId)?.name || 'next level')}…</small></div><span class="countdown-pill" data-countdown="${a.id}">${formatCountdown(req.verifyUntil - Date.now())}</span></div>`;
    } else if (req && req.status === 'pending_admin') {
        ctaHTML = `<div class="upgrade-status-banner ready"><div><strong>Verification complete</strong><small>Waiting on admin approval to upgrade to ${escapeHTML(getLevelById(req.levelId)?.name || 'next level')}.</small></div></div>`;
    } else if (nextLevel) {
        ctaHTML = unlocked
            ? `<div class="upgrade-cta-row"><button class="btn-friendly-primary" id="requestUpgradeBtn"><i class="fa-solid fa-arrow-up-right-dots"></i> Request Upgrade to ${escapeHTML(nextLevel.name)}</button></div>`
            : `<div class="upgrade-cta-row"><span class="upgrade-locked-note"><i class="fa-solid fa-lock"></i> Reach ${RANK_UPGRADE_THRESHOLD}% progress to unlock the upgrade request for ${escapeHTML(nextLevel.name)}.</span></div>`;
    } else if (level) {
        ctaHTML = `<div class="upgrade-cta-row"><span class="upgrade-locked-note"><i class="fa-solid fa-trophy"></i> You're at the top of the current ladder.</span></div>`;
    } else {
        ctaHTML = `<div class="upgrade-cta-row"><span class="upgrade-locked-note"><i class="fa-solid fa-circle-info"></i> No levels have been configured yet. Ask your admin to set one up.</span></div>`;
    }

    card.innerHTML = `
        <div class="rank-hero">
            <div class="rank-hero-left">
                <div class="rank-badge-icon"><i class="fa-solid fa-medal"></i></div>
                <div>
                    <div class="rank-name">${escapeHTML(level?.rankName || 'Unranked')}</div>
                    <div class="rank-level-label">${escapeHTML(level?.name || 'No level assigned yet')}</div>
                </div>
            </div>
            <div class="rank-progress-pct">${pct}%<small>Progress</small></div>
        </div>
        <div class="progress-meta-row"><span>${fmtINR(settled)} settled</span><span>Target: ${fmtINR(allocated)}</span></div>
        <div class="progress-track">
            <div class="progress-fill ${unlocked ? 'unlocked' : ''}" style="width:${pct}%;"></div>
            ${markerHTML}
        </div>
        <div class="rank-stats-row">
            <div class="rank-stat-box"><small>Allocated Amount</small><strong>${fmtINR(allocated)}</strong></div>
            <div class="rank-stat-box"><small>Settled Loans</small><strong>${fmtINR(settled)}</strong></div>
            <div class="rank-stat-box"><small>Next Level</small><strong>${nextLevel ? escapeHTML(nextLevel.name) : '—'}</strong></div>
        </div>
        ${level && level.benefits && level.benefits.length ? `<div class="benefit-chip-list">${level.benefits.map(b => `<span class="benefit-chip"><i class="fa-solid fa-check"></i>${escapeHTML(b)}</span>`).join('')}</div>` : ''}
        ${ctaHTML}
    `;

    document.getElementById('requestUpgradeBtn')?.addEventListener('click', () => requestUpgrade(a.id));
}

function requestUpgrade(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;
    if (!isUpgradeUnlocked(a)) return showToast('You need at least ' + RANK_UPGRADE_THRESHOLD + '% progress to request an upgrade.', 'danger');
    if (a.upgradeRequest) return showToast('You already have an upgrade request in progress.', 'warning');

    const nextLevel = getNextLevel(a);
    if (!nextLevel) return showToast('There is no further level to upgrade to.', 'warning');

    const verifyUntil = Date.now() + RANK_VERIFY_HOURS * 60 * 60 * 1000;
    a.upgradeRequest = { levelId: nextLevel.id, requestedAt: Date.now(), verifyUntil, status: 'verifying', pctAtRequest: getAgentProgressPct(a) };
    addAudit('Upgrade requested', `${a.name} requested upgrade to "${nextLevel.name}"`);
    saveState();
    renderMyRankPage();
    showToast(`Upgrade request submitted. Verification takes ${RANK_VERIFY_HOURS}h before admin can approve.`, 'success');
}

// Flips 'verifying' → 'pending_admin' the moment the countdown ends, for any
// agent (not just the one currently viewing the page) — checked on every tick.
function advanceVerificationStatuses() {
    let changed = false;
    agentState.forEach(a => {
        if (a.upgradeRequest && a.upgradeRequest.status === 'verifying' && Date.now() >= a.upgradeRequest.verifyUntil) {
            a.upgradeRequest.status = 'pending_admin';
            changed = true;
        }
    });
    if (changed) saveState();
    return changed;
}

function restartRankCountdownTicker() {
    if (_rankCountdownTimer) clearInterval(_rankCountdownTimer);
    _rankCountdownTimer = setInterval(() => {
        const justAdvanced = advanceVerificationStatuses();
        document.querySelectorAll('[data-countdown]').forEach(el => {
            const a = agentState.find(x => x.id === el.dataset.countdown);
            if (!a || !a.upgradeRequest || a.upgradeRequest.status !== 'verifying') return;
            el.textContent = formatCountdown(a.upgradeRequest.verifyUntil - Date.now());
        });
        if (justAdvanced) {
            renderMyRankPage();
            if (['admin', 'developer'].includes(state.user?.role)) renderUpgradeRequestsPanel();
        }
    }, 1000);
}

/* ---------------- LEADERBOARD (shared by agent + admin views) ---------------- */

function renderLeaderboard(root) {
    if (!root) return;
    const board = buildLeaderboard();
    if (!board.length) {
        root.innerHTML = '<p class="empty-row">No agents to rank yet.</p>';
        return;
    }
    root.innerHTML = board.map((row, i) => {
        const isMe = state.user?.role === 'agent' && row.agent.id === state.user.agentId;
        return `
        <div class="leaderboard-row ${isMe ? 'me' : ''}">
            <div class="leaderboard-rank-num">${i + 1}</div>
            <div class="leaderboard-name">${escapeHTML(row.agent.name)}${isMe ? ' (You)' : ''}<small>${escapeHTML(row.level?.rankName || 'Unranked')}</small></div>
            <div class="leaderboard-bar-mini"><div class="leaderboard-bar-mini-fill" style="width:${row.pct}%;"></div></div>
            <div class="leaderboard-pct">${row.pct}%</div>
        </div>`;
    }).join('');
}

/* ---------------- WIRING ---------------- */

function initRanking() {
    document.getElementById('addLevelBtn')?.addEventListener('click', () => showLevelFormModal(null));
}
