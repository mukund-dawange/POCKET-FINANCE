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
     xp                — cumulative XP earned (number, starts at 0)
     levelId           — id of their current level (or '' = unranked/base)
     upgradeRequest     — { levelId, requestedAt, verifyUntil, status }
                          status: 'verifying' | 'pending_admin' | null

   XP SYSTEM:
     - XP is awarded ONLY when interest is successfully (fully) collected.
       Missed/overdue/partial interest payments never generate XP.
     - XP earned per fully-settled interest cycle = that loan's interest
       rate % (e.g. ₹1000 loan @ 10%/month → +10 XP each month it's paid
       in full). Awarded automatically the instant a payment fully clears
       an interest entry — see awardAgentXP() in repayLoan() (wallet.js).
       Example: ₹1000 loan, 10%/month, paid in full for 3 months → +30 XP.

   AGENT XP TARGET (per agent, based on their allocated fund):
     Target Amount = 70% of Allocated Fund
     XP Target     = Target Amount × 2
     Example: Allocated Fund ₹1000 → Target Amount ₹700 → XP Target 1400.
     Agents must reach their XP Target (100% by default, configurable per
     level via targetPct) to qualify for rank progression / upgrade requests.
   ============================================================ */

const RANK_VERIFY_HOURS = 24;          // verification countdown length
const RANK_UPGRADE_THRESHOLD = 100;    // % of XP Target required to unlock upgrade requests (reach full XP Target by default)

/* ---------------- DEFAULT POCKET FINANCER LEVELS ---------------- */
// Based on the Pocket Financer Fund Increase Chart.
// Seeded automatically on first load if no levels exist yet.
const POCKET_FINANCER_DEFAULT_LEVELS = [
    { order: 1,  name: 'Level 1',  rankName: 'No Rank',       targetPct: 100, allocationLimit: 1300,    benefits: ['Starting rank — ₹1,300 fund allocated'] },
    { order: 2,  name: 'Level 2',  rankName: 'Bronze 1',      targetPct: 100, allocationLimit: 2067,    benefits: ['Fund increased to ₹2,067', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 3,  name: 'Level 3',  rankName: 'Bronze 2',      targetPct: 100, allocationLimit: 2833,    benefits: ['Fund increased to ₹2,833', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 4,  name: 'Level 4',  rankName: 'Bronze 3',      targetPct: 100, allocationLimit: 3600,    benefits: ['Fund increased to ₹3,600', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 5,  name: 'Level 5',  rankName: 'Silver 1',      targetPct: 100, allocationLimit: 4133,    benefits: ['Fund increased to ₹4,133', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 6,  name: 'Level 6',  rankName: 'Silver 2',      targetPct: 100, allocationLimit: 4667,    benefits: ['Fund increased to ₹4,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 7,  name: 'Level 7',  rankName: 'Silver 3',      targetPct: 100, allocationLimit: 5200,    benefits: ['Fund increased to ₹5,200', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 8,  name: 'Level 8',  rankName: 'Gold 1',        targetPct: 100, allocationLimit: 6933,    benefits: ['Fund increased to ₹6,933', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 9,  name: 'Level 9',  rankName: 'Gold 2',        targetPct: 100, allocationLimit: 8667,    benefits: ['Fund increased to ₹8,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 10, name: 'Level 10', rankName: 'Gold 3',        targetPct: 100, allocationLimit: 10400,   benefits: ['Fund increased to ₹10,400', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 11, name: 'Level 11', rankName: 'Platinum 1',    targetPct: 100, allocationLimit: 13867,   benefits: ['Fund increased to ₹13,867', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 12, name: 'Level 12', rankName: 'Platinum 2',    targetPct: 100, allocationLimit: 17333,   benefits: ['Fund increased to ₹17,333', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 13, name: 'Level 13', rankName: 'Platinum 3',    targetPct: 100, allocationLimit: 20800,   benefits: ['Fund increased to ₹20,800', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 14, name: 'Level 14', rankName: 'Diamond 1',     targetPct: 100, allocationLimit: 27733,   benefits: ['Fund increased to ₹27,733', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 15, name: 'Level 15', rankName: 'Diamond 2',     targetPct: 100, allocationLimit: 34667,   benefits: ['Fund increased to ₹34,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 16, name: 'Level 16', rankName: 'Diamond 3',     targetPct: 100, allocationLimit: 41600,   benefits: ['Fund increased to ₹41,600', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 17, name: 'Level 17', rankName: 'Master 1',      targetPct: 100, allocationLimit: 55467,   benefits: ['Fund increased to ₹55,467', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 18, name: 'Level 18', rankName: 'Master 2',      targetPct: 100, allocationLimit: 69333,   benefits: ['Fund increased to ₹69,333', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 19, name: 'Level 19', rankName: 'Master 3',      targetPct: 100, allocationLimit: 83200,   benefits: ['Fund increased to ₹83,200', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 20, name: 'Level 20', rankName: 'Grand Master 1',targetPct: 100, allocationLimit: 110933,  benefits: ['Fund increased to ₹1,10,933', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 21, name: 'Level 21', rankName: 'Grand Master 2',targetPct: 100, allocationLimit: 138667,  benefits: ['Fund increased to ₹1,38,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 22, name: 'Level 22', rankName: 'Grand Master 3',targetPct: 100, allocationLimit: 166400,  benefits: ['Fund increased to ₹1,66,400', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 23, name: 'Level 23', rankName: 'Challenger 1',  targetPct: 100, allocationLimit: 221867,  benefits: ['Fund increased to ₹2,21,867', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 24, name: 'Level 24', rankName: 'Challenger 2',  targetPct: 100, allocationLimit: 277333,  benefits: ['Fund increased to ₹2,77,333', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 25, name: 'Level 25', rankName: 'Challenger 3',  targetPct: 100, allocationLimit: 332800,  benefits: ['Fund increased to ₹3,32,800', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 26, name: 'Level 26', rankName: 'Supreme 1',     targetPct: 100, allocationLimit: 443733,  benefits: ['Fund increased to ₹4,43,733', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 27, name: 'Level 27', rankName: 'Supreme 2',     targetPct: 100, allocationLimit: 554667,  benefits: ['Fund increased to ₹5,54,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 28, name: 'Level 28', rankName: 'Supreme 3',     targetPct: 100, allocationLimit: 665600,  benefits: ['Fund increased to ₹6,65,600', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 29, name: 'Level 29', rankName: 'Radiant 1',     targetPct: 100, allocationLimit: 887467,  benefits: ['Fund increased to ₹8,87,467', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 30, name: 'Level 30', rankName: 'Radiant 2',     targetPct: 100, allocationLimit: 1109333, benefits: ['Fund increased to ₹11,09,333', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 31, name: 'Level 31', rankName: 'Radiant 3',     targetPct: 100, allocationLimit: 1331200, benefits: ['Fund increased to ₹13,31,200', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 32, name: 'Level 32', rankName: 'Titan 1',       targetPct: 100, allocationLimit: 1774933, benefits: ['Fund increased to ₹17,74,933', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 33, name: 'Level 33', rankName: 'Titan 2',       targetPct: 100, allocationLimit: 2218667, benefits: ['Fund increased to ₹22,18,667', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
    { order: 34, name: 'Level 34', rankName: 'Titan 3',       targetPct: 100, allocationLimit: 2662400, benefits: ['Fund increased to ₹26,62,400', 'Unlock after reaching XP Target (based on prior level\'s ₹ allocation)'] },
];

function seedDefaultLevels() {
    const existing = state.levelDefs || [];

    // Only seed when there are truly NO levels at all — first run, or the
    // ladder got wiped (e.g. a stale browser tab's auto-sync overwriting
    // shared state with an old/empty levelDefs array). If admin has ever
    // added/removed/edited levels, existing.length will differ from the
    // default 34 on purpose — we must NOT force-reseed in that case, or
    // every edit gets silently undone on the next load.
    if (existing.length > 0) return;

    // Create the default ladder with fresh IDs
    state.levelDefs = POCKET_FINANCER_DEFAULT_LEVELS.map(lv => ({
        ...lv,
        id: genId('level')
    }));

    const firstLevel = state.levelDefs[0];

    // Any agent without a level (which is everyone, since this only runs
    // when the ladder was empty) starts on the entry tier.
    agentState.forEach(a => {
        if (!a.levelId || !state.levelDefs.some(lv => lv.id === a.levelId)) {
            a.levelId = firstLevel.id;
            if (!a.allocatedAmount) a.allocatedAmount = Number(a.fund) || firstLevel.allocationLimit;
        }
    });

    saveState();
    console.log('[Ranking] Levels seeded: ' + state.levelDefs.length + ' default tiers created.');
}

/* ---------------- CORE CALCULATIONS ---------------- */

function getAgentAllocated(agent) {
    // Use explicitly set allocatedAmount; fall back to the agent's fund
    // so progress is always meaningful even before admin sets a target.
    return Number(agent?.allocatedAmount) || Number(agent?.fund) || 0;
}

function getAgentSettledAmount(agentId) {
    return state.loans
        .filter(l => l.agentId === agentId && l.status === 'Paid')
        .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
}

/* ---------------- XP SYSTEM ----------------
   XP is awarded ONLY when interest is successfully (fully) collected —
   missed/overdue/partial interest never generates XP.
   XP earned per fully-settled interest cycle = that loan's interest rate %
   (e.g. ₹1000 loan @ 10%/month → +10 XP each month it's paid in full).
   Awarded automatically from repayLoan() the moment an interest entry
   flips to paid=true. See awardAgentXP() below. */

function getAgentXP(agent) {
    return round2(Number(agent?.xp) || 0);
}

function awardAgentXP(agentId, xpAmount, loanLabel) {
    const a = agentState.find(x => x.id === agentId);
    if (!a || !xpAmount) return;
    a.xp = round2((Number(a.xp) || 0) + xpAmount);
    if (typeof addAudit === 'function') addAudit('XP earned', `${a.name} earned +${xpAmount} XP from interest collected${loanLabel ? ` on ${loanLabel}'s loan` : ''}`);
}

// Target Amount = 70% of Allocated Fund. XP Target = Target Amount × 2.
function getAgentTargetAmount(agent) {
    return round2(getAgentAllocated(agent) * 0.7);
}

function getAgentXPTarget(agent) {
    return round2(getAgentTargetAmount(agent) * 2);
}

function getAgentProgressPct(agent) {
    const xpTarget = getAgentXPTarget(agent);
    if (!xpTarget) return 0;
    return Math.min(100, round2((getAgentXP(agent) / xpTarget) * 100));
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

function getUpgradeThreshold(agent) {
    // targetPct lives on the CURRENT level — "what % must I reach to leave this tier"
    const current = getAgentCurrentLevel(agent);
    return Number(current?.targetPct) || RANK_UPGRADE_THRESHOLD;
}

function isUpgradeUnlocked(agent) {
    return getAgentProgressPct(agent) >= getUpgradeThreshold(agent) && !!getNextLevel(agent);
}

/* ---------------- LEADERBOARD ---------------- */

function buildLeaderboard() {
    return agentState
        .filter(a => !a.disabled)
        .map(a => ({
            agent: a,
            pct: getAgentProgressPct(a),
            xp: getAgentXP(a),
            xpTarget: getAgentXPTarget(a),
            settled: getAgentSettledAmount(a.id),
            allocated: getAgentAllocated(a),
            level: getAgentCurrentLevel(a)
        }))
        .sort((x, y) => y.pct - x.pct);
}

/* ============================================================
   ADMIN / DEV — Level & Rank management
   ============================================================ */

/* ---------------- ADMIN / DEV: Level CRUD ---------------- */
// Admin/Dev can create custom levels, rename ranks, and set targets,
// allocation limits and benefits. Defaults above are just a starting
// point — fully editable, addable, and removable.

function showLevelFormModal(levelId = null) {
    const isEdit = !!levelId;
    const lv = isEdit ? getLevelById(levelId) : null;
    const levels = sortedLevelDefs();
    const maxOrder = levels.length ? Math.max(...levels.map(l => l.order || 0)) : 0;

    showFormModal({
        title: isEdit ? `Edit Level — ${lv.name}` : 'Create New Level',
        icon: 'fa-ranking-star',
        submitLabel: isEdit ? 'Save Changes' : 'Create Level',
        wide: true,
        intro: 'Define the ladder position (order), display name, rank label, progress target to unlock upgrade requests, fund allocation for this tier, and any benefits to show agents.',
        fields: [
            { id: 'order', label: 'Ladder Position (order)', type: 'number', required: true, min: 1, value: isEdit ? lv.order : maxOrder + 1, help: 'Lowest number = entry level. Determines ladder sequence.' },
            { id: 'name', label: 'Level Name', type: 'text', required: true, value: isEdit ? lv.name : '', placeholder: 'e.g. Level 13' },
            { id: 'rankName', label: 'Rank Name', type: 'text', required: true, value: isEdit ? lv.rankName : '', placeholder: 'e.g. Legend' },
            { id: 'targetPct', label: 'XP Target % to Unlock Upgrade from This Level', type: 'number', required: true, min: 1, max: 100, value: isEdit ? lv.targetPct : RANK_UPGRADE_THRESHOLD, help: 'Agents on THIS level must reach this % of their XP Target to unlock an upgrade request to the next level. Default is ' + RANK_UPGRADE_THRESHOLD + '%.' },
            { id: 'allocationLimit', label: 'Allocation Limit (₹)', type: 'number', required: true, min: 0, step: '0.01', value: isEdit ? lv.allocationLimit : '', help: 'Fund cap / allocation given to agents at this level.' },
            { id: 'benefits', label: 'Benefits (one per line)', type: 'textarea', full: true, rows: 4, value: isEdit ? (lv.benefits || []).join('\n') : '', placeholder: 'e.g. Fund increased to ₹X\nPriority support' }
        ],
        onSubmit: (v) => {
            const order = Number(v.order);
            const targetPct = Number(v.targetPct);
            const allocationLimit = Number(v.allocationLimit);
            if (!v.name || !v.rankName) return showToast('Level name and rank name are required.', 'danger');
            if (isNaN(order) || order < 1) return showToast('Enter a valid ladder position.', 'danger');
            if (isNaN(targetPct) || targetPct < 1 || targetPct > 100) return showToast('Progress target must be between 1 and 100.', 'danger');
            if (isNaN(allocationLimit) || allocationLimit < 0) return showToast('Enter a valid allocation limit.', 'danger');
            const benefits = v.benefits.split('\n').map(s => s.trim()).filter(Boolean);

            state.levelDefs = state.levelDefs || [];
            if (isEdit) {
                Object.assign(lv, { order, name: v.name, rankName: v.rankName, targetPct, allocationLimit, benefits });
                addAudit('Level updated', `Level "${v.name}" (${v.rankName}) updated`);
                showToast('Level updated.', 'success');
            } else {
                state.levelDefs.push({ id: genId('level'), order, name: v.name, rankName: v.rankName, targetPct, allocationLimit, benefits });
                addAudit('Level created', `New level "${v.name}" (${v.rankName}) created`);
                showToast('Level created.', 'success');
            }
            saveState();
            renderLevelManager();
            renderMyRankPage();
            if (typeof renderAgentManager === 'function') renderAgentManager();
        }
    });
}

function deleteLevel(levelId) {
    const lv = getLevelById(levelId);
    if (!lv) return;
    const inUse = agentState.some(a => a.levelId === levelId);
    if (inUse && !confirm(`"${lv.name}" (${lv.rankName}) is currently assigned to one or more agents. Delete anyway? Those agents will become unranked.`)) return;
    if (!inUse && !confirm(`Delete level "${lv.name}" (${lv.rankName})? This cannot be undone.`)) return;

    state.levelDefs = (state.levelDefs || []).filter(l => l.id !== levelId);
    agentState.forEach(a => { if (a.levelId === levelId) a.levelId = ''; });
    addAudit('Level deleted', `Level "${lv.name}" (${lv.rankName}) deleted`);
    saveState();
    renderLevelManager();
    renderMyRankPage();
    if (typeof renderAgentManager === 'function') renderAgentManager();
    showToast('Level deleted.', 'warning');
}

function renderLevelManager() {
    const root = document.getElementById('levelManagerList');
    if (!root) return;
    const levels = sortedLevelDefs();
    if (!levels.length) {
        root.innerHTML = '<p class="empty-row">No levels yet. Click "Add Level" to create the first rank tier.</p>';
        return;
    }
    root.innerHTML = levels.map(lv => {
        const ti = getRankIcon(lv.rankName);
        const agentCount = agentState.filter(a => a.levelId === lv.id).length;
        return `
        <div class="request-row" data-level-row="${lv.id}">
            <div class="request-row-info">
                <strong><i class="fa-solid ${ti.icon}" style="color:${ti.color};margin-right:6px"></i>${escapeHTML(lv.name)} — ${escapeHTML(lv.rankName)}</strong>
                <small>Order ${lv.order} · Target ${lv.targetPct}% · Allocation ${fmtINR(lv.allocationLimit)} · ${agentCount} agent${agentCount === 1 ? '' : 's'}</small>
                ${(lv.benefits || []).length ? `<small style="color:var(--text-muted)">${lv.benefits.map(escapeHTML).join(' · ')}</small>` : ''}
            </div>
            <div class="request-row-actions">
                <button class="btn-friendly-secondary compact" data-edit-level="${lv.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn-friendly-secondary compact" data-delete-level="${lv.id}"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
        </div>`;
    }).join('');
    root.querySelectorAll('[data-edit-level]').forEach(b => b.onclick = () => showLevelFormModal(b.dataset.editLevel));
    root.querySelectorAll('[data-delete-level]').forEach(b => b.onclick = () => deleteLevel(b.dataset.deleteLevel));
}

function showSetAllocationModal(agentId, creditFund = false) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;
    const level = getAgentCurrentLevel(a);
    showFormModal({
        title: `Set Allocated Amount — ${a.name}`,
        icon: 'fa-bullseye',
        submitLabel: creditFund ? 'Allocate Fund' : 'Save Allocation',
        intro: creditFund
            ? `Enter the amount to give ${a.name} to lend at their new level${level ? ` ("${level.name}")` : ''}. This becomes their available lending balance on the dashboard.`
            : (level && level.allocationLimit ? `This agent's level ("${level.name}") caps allocation at ${fmtINR(level.allocationLimit)}.` : 'This is the lending target progress is measured against — separate from their cash fund.'),
        fields: [
            { id: 'allocatedAmount', label: creditFund ? 'Fund to Allocate (₹)' : 'Allocated Amount / Rank Target (₹)', type: 'number', required: true, min: 0, step: '0.01', value: getAgentAllocated(a), help: creditFund ? "This amount is credited directly to the agent's lending fund — it's what they'll see as Total Allocated / Available to Issue." : "The lending target used to measure progress. Defaults to the agent's fund if not set." }
        ],
        onSubmit: (v) => {
            const amt = Number(v.allocatedAmount);
            if (amt < 0 || isNaN(amt)) return showToast('Enter a valid amount.', 'danger');
            if (level && level.allocationLimit && amt > level.allocationLimit) return showToast(`Cannot exceed this agent's level limit of ${fmtINR(level.allocationLimit)}.`, 'danger');
            a.allocatedAmount = amt;
            if (creditFund) {
                // This allocation IS the agent's usable lending balance now —
                // credit it directly, not just the rank-progress target.
                a.fund = amt;
                addAudit('Fund allocated', `${fmtINR(amt)} allocated to "${a.name}" as their lending fund for the new level`);
                showToast(`${fmtINR(amt)} allocated to ${a.name}. They can now issue loans.`, 'success');
            } else {
                addAudit('Allocation set', `Allocated amount for "${a.name}" set to ${fmtINR(amt)}`);
                showToast('Allocated amount updated.', 'success');
            }
            saveState();
            renderAgentManager();
            if (typeof renderAgentDashboardPanel === 'function') renderAgentDashboardPanel();
            if (typeof renderMyRankPage === 'function') renderMyRankPage();
        }
    });
}

/* ---------------- ADMIN: upgrade request review ---------------- */

function renderAdminIncomePanel() {
    const root = document.getElementById('adminIncomePanel');
    if (!root) return;

    const total = round2(Number(state.adminIncome) || 0);
    const history = state.adminIncomeHistory || [];
    const agentIncomes = agentState
        .filter(a => a.incomeEarned > 0)
        .sort((a, b) => (b.incomeEarned || 0) - (a.incomeEarned || 0));

    // Collection pool totals across all agents
    const totalCollectionPool = round2(agentState.reduce((s, a) => s + (Number(a.collectionPool) || 0), 0));
    const totalPrincipalCollected = round2(agentState.reduce((s, a) => s + apAgentLoans(a.id).reduce((ls, l) => ls + (Number(l.principalPaidTotal) || 0), 0), 0));
    const totalInterestCollected = round2(agentState.reduce((s, a) => s + (Number(apInterestCollectedTotal(a.id)) || 0), 0));

    root.innerHTML = `
        <div class="income-summary-row" style="margin-bottom:18px;">
            <div class="income-summary-box" style="border-top:3px solid #0ea5e9;">
                <div class="income-summary-label">Total Collection Pool</div>
                <div class="income-summary-val" style="color:#0ea5e9;">${fmtINR(totalCollectionPool)}</div>
                <div class="income-summary-sub">Principal + interest collected by all agents</div>
            </div>
            <div class="income-summary-box" style="border-top:3px solid #10b981;">
                <div class="income-summary-label">Principal Collected</div>
                <div class="income-summary-val" style="color:#10b981;">${fmtINR(totalPrincipalCollected)}</div>
                <div class="income-summary-sub">Loan principal repaid by clients</div>
            </div>
            <div class="income-summary-box" style="border-top:3px solid var(--purple);">
                <div class="income-summary-label">Interest Collected</div>
                <div class="income-summary-val" style="color:var(--purple);">${fmtINR(totalInterestCollected)}</div>
                <div class="income-summary-sub">Interest paid by clients to agents</div>
            </div>
        </div>
        <h4 style="margin:0 0 12px;font-size:13px;color:var(--text-secondary);font-weight:600;border-top:1px solid var(--border);padding-top:16px;">Rank-Upgrade Income</h4>
        <div class="income-summary-row">
            <div class="income-summary-box">
                <div class="income-summary-label">Admin / Dev Pool</div>
                <div class="income-summary-val">${fmtINR(total)}</div>
                <div class="income-summary-sub">Total accumulated across all agent upgrades</div>
            </div>
            <div class="income-summary-box">
                <div class="income-summary-label">Total Agent Payouts</div>
                <div class="income-summary-val">${fmtINR(agentState.reduce((s, a) => s + (Number(a.incomeEarned) || 0), 0))}</div>
                <div class="income-summary-sub">Paid out to agents on upgrade</div>
            </div>
        </div>
        ${agentIncomes.length ? `
        <h4 style="margin:16px 0 8px;font-size:13px;color:var(--text-secondary);font-weight:600;">Per-Agent Income</h4>
        <div class="table-responsive">
            <table><thead><tr><th>Agent</th><th>Rank</th><th>Agent Earned</th><th>Admin Share</th><th>Collection Pool</th><th>Upgrades</th></tr></thead>
            <tbody>${agentIncomes.map(a => {
                const level = getAgentCurrentLevel(a);
                const upgrades = (a.incomeHistory || []).length;
                const adminTotal = (a.incomeHistory || []).reduce((s, h) => s + (h.adminShare || 0), 0);
                return `<tr>
                    <td><strong>${escapeHTML(a.name)}</strong></td>
                    <td>${escapeHTML(level?.rankName || 'No Rank')}</td>
                    <td style="color:var(--success);font-weight:700;">${fmtINR(a.incomeEarned || 0)}</td>
                    <td style="color:var(--purple);font-weight:700;">${fmtINR(adminTotal)}</td>
                    <td style="color:#0ea5e9;font-weight:700;">${fmtINR(a.collectionPool || 0)}</td>
                    <td>${upgrades}</td>
                </tr>`;
            }).join('')}</tbody></table>
        </div>` : '<p class="empty-row" style="margin-top:12px;">No income recorded yet — income is generated when agents are approved for rank upgrades.</p>'}
        ${history.length ? `
        <h4 style="margin:16px 0 8px;font-size:13px;color:var(--text-secondary);font-weight:600;">Income History</h4>
        <div class="table-responsive">
            <table><thead><tr><th>Date</th><th>Agent</th><th>Level</th><th>Admin +</th></tr></thead>
            <tbody>${history.slice(0, 20).map(h => `<tr>
                <td>${new Date(h.date).toLocaleDateString('en-IN')}</td>
                <td>${escapeHTML(h.agentName)}</td>
                <td>${escapeHTML(h.level)} — ${escapeHTML(h.rankName)}</td>
                <td style="color:var(--purple);font-weight:700;">+${fmtINR(h.amount)}</td>
            </tr>`).join('')}</tbody></table>
        </div>` : ''}
    `;
}

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
                <button class="btn-friendly-primary compact" data-approve="${a.id}"><i class="fa-solid fa-check"></i> Approve</button>
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
    const newLevel = getLevelById(req.levelId);
    if (!newLevel) return showToast('Target level no longer exists.', 'danger');

    // --- INCOME SYSTEM ---
    // Total income pool = XP earned / 2  (2 XP = ₹1)
    // Agent gets 50%, Admin/Dev pool gets 50%
    const xpEarned = round2(Number(a.xp) || 0);
    const totalPool = round2(xpEarned / 2);
    const agentShare = round2(totalPool / 2);
    const adminShare = round2(totalPool - agentShare);

    a.incomeEarned = round2((Number(a.incomeEarned) || 0) + agentShare);
    a.incomeHistory = a.incomeHistory || [];
    a.incomeHistory.unshift({
        date: Date.now(),
        level: newLevel.name,
        rankName: newLevel.rankName,
        xpAtUpgrade: xpEarned,
        totalPool,
        agentShare,
        adminShare
    });

    // Accumulate admin/dev pool on shared state
    state.adminIncome = round2((Number(state.adminIncome) || 0) + adminShare);
    state.adminIncomeHistory = state.adminIncomeHistory || [];
    state.adminIncomeHistory.unshift({
        date: Date.now(),
        agentName: a.name,
        level: newLevel.name,
        rankName: newLevel.rankName,
        amount: adminShare
    });
    // --- END INCOME ---

    a.levelId = newLevel.id;
    // Fund AND allocation target both reset on promotion — admin/dev must
    // manually allocate a fresh amount for this level (no auto-allocation).
    a.fund = 0;
    a.allocatedAmount = 0;
    a.upgradeRequest = null;
    addAudit('Upgrade approved', `${a.name} upgraded to "${newLevel.name}" (${newLevel.rankName}) · Agent earned ₹${agentShare}, Admin pool +₹${adminShare}`);
    saveState();
    renderUpgradeRequestsPanel();
    renderAgentManager();
    renderMyRankPage();
    showToast(`${a.name} upgraded to ${newLevel.name}. Agent income +₹${agentShare.toLocaleString('en-IN')} 💰 — now allocate their fund for this level.`, 'success');
    // Force the admin/dev to manually set the new allocation right away —
    // upgrading no longer auto-fills it from the level's allocation limit.
    // creditFund=true: this amount becomes the agent's actual lending fund,
    // not just a rank-progress target.
    showSetAllocationModal(a.id, true);
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

/* ---- RANK ICONS per tier ---- */
const RANK_TIER_ICONS = {
    'No Rank':     { icon: 'fa-circle-xmark',    color: '#6b7280' },
    'Bronze':      { icon: 'fa-medal',            color: '#CD7F32' },
    'Silver':      { icon: 'fa-medal',            color: '#9ca3af' },
    'Gold':        { icon: 'fa-medal',            color: '#f59e0b' },
    'Platinum':    { icon: 'fa-gem',              color: '#60a5fa' },
    'Diamond':     { icon: 'fa-gem',              color: '#a78bfa' },
    'Master':      { icon: 'fa-star',             color: '#fbbf24' },
    'Grand Master':{ icon: 'fa-star-half-stroke', color: '#f97316' },
    'Challenger':  { icon: 'fa-bolt',             color: '#f43f5e' },
    'Supreme':     { icon: 'fa-fire',             color: '#ef4444' },
    'Radiant':     { icon: 'fa-sparkles',         color: '#c084fc' },
    'Titan':       { icon: 'fa-crown',            color: '#fde68a' },
};

function getRankIcon(rankName) {
    if (!rankName) return { icon: 'fa-circle', color: '#6b7280' };
    if (RANK_TIER_ICONS[rankName]) return RANK_TIER_ICONS[rankName];
    // For sub-ranks like "Bronze 1", "Grand Master 2" — match by tier prefix
    const match = Object.keys(RANK_TIER_ICONS).find(k => rankName.startsWith(k + ' '));
    return match ? RANK_TIER_ICONS[match] : { icon: 'fa-circle', color: '#6b7280' };
}

function renderMyRankPage() {
    // Self-heal: if the ladder ever comes back empty (e.g. a background
    // auto-sync pulled in a stale/empty levelDefs from another tab), rebuild
    // it right before rendering instead of showing "No levels yet".
    seedDefaultLevels();

    const isAgent = state.user?.role === 'agent';
    const isAdminOrDev = ['admin', 'developer'].includes(state.user?.role);

    if (isAgent) renderAgentRankCard();
    renderLeaderboard(document.getElementById('leaderboardList'));

    if (isAdminOrDev) {
        renderUpgradeRequestsPanel();
        renderAdminIncomePanel();
        renderLeaderboard(document.getElementById('leaderboardListAdmin'));
        renderLevelManager();
    }

    restartRankCountdownTicker();
}

function renderAgentRankCard() {
    const card = document.getElementById('myRankCard');
    const ladderCard = document.getElementById('xp-ladder-card');
    const upgradeCard = document.getElementById('xp-upgrade-card');
    const headerBadge = document.getElementById('xp-rank-badge-header');
    if (!card) return;

    const a = agentState.find(x => x.id === state.user.agentId);
    if (!a) {
        card.innerHTML = '<p class="empty-row">Your agent record could not be found.</p>';
        if (ladderCard) ladderCard.innerHTML = '';
        if (upgradeCard) upgradeCard.innerHTML = '';
        return;
    }

    const pct = getAgentProgressPct(a);
    const level = getAgentCurrentLevel(a);
    const nextLevel = getNextLevel(a);
    const allocated = getAgentAllocated(a);
    const xp = getAgentXP(a);
    const xpTarget = getAgentXPTarget(a);
    const targetAmount = getAgentTargetAmount(a);
    const unlocked = isUpgradeUnlocked(a);
    const req = a.upgradeRequest;
    const levels = sortedLevelDefs();
    const currentIdx = level ? levels.findIndex(lv => lv.id === level.id) : -1;
    const tierInfo = getRankIcon(level?.rankName || '');
    const nextTierInfo = getRankIcon(nextLevel?.rankName || '');

    // Header badge
    if (headerBadge) {
        headerBadge.textContent = (level?.rankName || 'Unranked') + ' Rank';
        headerBadge.style.cssText = `background:${tierInfo.color}22;color:${tierInfo.color};border:1px solid ${tierInfo.color}44;padding:4px 14px;border-radius:99px;font-size:12px;font-weight:700;`;
    }

    // ---- MAIN CARD: XP circle + progress bar ----
    const thresholdPct = getUpgradeThreshold(a);
    const nextAllocLabel = nextLevel ? fmtINR(nextLevel.allocationLimit) : '—';
    // Bar label ticks: current rank start, threshold, next rank
    const barFromLabel = level?.rankName || 'Current';
    const barToLabel = nextLevel?.rankName || 'Max';
    // Threshold expressed in XP units
    const thresholdXP = xpTarget ? Math.round((thresholdPct / 100) * xpTarget) : 0;

    card.innerHTML = `
        <div class="xp-card-inner">
            <div class="xp-circle-col">
                <div class="xp-circle" style="--xp-color:${tierInfo.color}">
                    <svg viewBox="0 0 100 100" class="xp-circle-svg">
                        <circle cx="50" cy="50" r="42" class="xp-circle-bg"/>
                        <circle cx="50" cy="50" r="42" class="xp-circle-fill"
                            style="stroke:${tierInfo.color};stroke-dasharray:${Math.round(pct * 2.639)}, 263.9"/>
                    </svg>
                    <div class="xp-circle-content">
                        <div class="xp-circle-val">${Math.round(xp)}</div>
                        <div class="xp-circle-sub">XP</div>
                    </div>
                </div>
            </div>
            <div class="xp-info-col">
                <div class="xp-rank-row">
                    <i class="fa-solid ${tierInfo.icon}" style="color:${tierInfo.color};font-size:18px"></i>
                    <div>
                        <div class="xp-rank-title">${escapeHTML(level?.rankName || 'Unranked')} — ${escapeHTML(level?.name || 'No level assigned')}</div>
                        <div class="xp-rank-sub">${unlocked ? 'XP Target reached — claim your rank upgrade below!' : `Reach ${thresholdPct}% of your XP Target to unlock upgrade`}</div>
                    </div>
                </div>
                <div class="xp-progress-label-row">
                    <span>XP toward ${escapeHTML(level?.rankName || 'current')} → ${escapeHTML(nextLevel?.rankName || 'Max')} upgrade</span>
                    <strong>${Math.round(xp)} / ${Math.round(xpTarget)} XP — ${unlocked ? 'Ready to upgrade! ✅' : pct + '% complete'}</strong>
                </div>
                <div class="xp-bar-track">
                    <div class="xp-bar-fill ${unlocked ? 'ready' : ''}" style="width:${pct}%;background:${unlocked ? 'linear-gradient(90deg,#10b981,#34d399)' : `linear-gradient(90deg,${tierInfo.color},${nextTierInfo.color})`}"></div>
                    <div class="xp-bar-marker" style="left:${thresholdPct}%">
                        <div class="xp-bar-marker-line"></div>
                    </div>
                </div>
                <div class="xp-bar-ticks">
                    <span>${escapeHTML(barFromLabel)}</span>
                    <span style="position:absolute;left:${thresholdPct}%;transform:translateX(-50%)">${thresholdXP} XP</span>
                    <span>${escapeHTML(barToLabel)}</span>
                </div>
                <div class="xp-progress-label-row" style="margin-top:2px;">
                    <span>Allocated Fund ${fmtINR(allocated)} · Target Amount (70%) ${fmtINR(targetAmount)}</span>
                </div>
                ${(level?.benefits || []).length ? `
                <div class="benefit-chip-list">
                    ${level.benefits.map(b => `<span class="benefit-chip"><i class="fa-solid fa-check"></i>${escapeHTML(b)}</span>`).join('')}
                </div>` : ''}
            </div>
        </div>
    `;

    // ---- RANK LADDER TRACK ----
    if (ladderCard) {
        const ladderHTML = levels.map((lv, i) => {
            const ti = getRankIcon(lv.rankName);
            const isCurrent = lv.id === level?.id;
            const isPast = currentIdx >= 0 && i < currentIdx;
            const isNext = nextLevel && lv.id === nextLevel.id;
            const cls = isCurrent ? 'xp-ladder-step current' : isPast ? 'xp-ladder-step done' : isNext ? 'xp-ladder-step next' : 'xp-ladder-step locked';
            const connector = i < levels.length - 1 ? `<div class="xp-ladder-connector ${isPast || isCurrent ? 'done' : ''}"></div>` : '';
            return `
                <div class="${cls}">
                    <div class="xp-ladder-icon" style="${isCurrent || isPast ? `background:${ti.color}22;border-color:${ti.color};color:${ti.color}` : ''}">
                        ${isPast ? '<i class="fa-solid fa-check"></i>' : `<i class="fa-solid ${ti.icon}"></i>`}
                    </div>
                    <div class="xp-ladder-label">${escapeHTML(lv.rankName)}</div>
                </div>
                ${connector}`;
        }).join('');
        ladderCard.innerHTML = `<div class="xp-ladder-track">${ladderHTML}</div>`;
    }

    // ---- UPGRADE CTA ----
    if (upgradeCard) {
        let upgradeHTML = '';
        if (req && req.status === 'verifying') {
            upgradeHTML = `
                <div class="xp-upgrade-inner verifying">
                    <div class="xp-upgrade-left">
                        <div class="xp-upgrade-title">Upgrade request submitted</div>
                        <div class="xp-upgrade-sub">Verifying eligibility for <strong>${escapeHTML(getLevelById(req.levelId)?.name || 'next level')}</strong>…<br>Verification period: ${RANK_VERIFY_HOURS} hours</div>
                    </div>
                    <span class="xp-countdown" data-countdown="${a.id}">${formatCountdown(req.verifyUntil - Date.now())}</span>
                </div>`;
        } else if (req && req.status === 'pending_admin') {
            upgradeHTML = `
                <div class="xp-upgrade-inner pending">
                    <div class="xp-upgrade-left">
                        <div class="xp-upgrade-title">✅ Verification complete</div>
                        <div class="xp-upgrade-sub">Waiting on admin approval to upgrade to <strong>${escapeHTML(getLevelById(req.levelId)?.name || 'next level')}</strong>.</div>
                    </div>
                </div>`;
        } else if (nextLevel && unlocked) {
            const nti = getRankIcon(nextLevel.rankName);
            upgradeHTML = `
                <div class="xp-upgrade-inner ready">
                    <div class="xp-upgrade-left">
                        <div class="xp-upgrade-title">Ready to upgrade to ${escapeHTML(nextLevel.rankName)}! <i class="fa-solid ${nti.icon}" style="color:${nti.color}"></i></div>
                        <div class="xp-upgrade-sub">You've earned ${Math.round(xp)} XP — XP Target met (${thresholdXP} XP). Fund upgrades to <strong>${nextAllocLabel}</strong>.</div>
                    </div>
                    <button class="xp-upgrade-btn" id="requestUpgradeBtn">
                        <i class="fa-solid ${nti.icon}"></i> Upgrade to ${escapeHTML(nextLevel.rankName)}
                    </button>
                </div>`;
        } else if (nextLevel) {
            upgradeHTML = `
                <div class="xp-upgrade-inner locked">
                    <div class="xp-upgrade-left">
                        <div class="xp-upgrade-title"><i class="fa-solid fa-lock" style="margin-right:6px"></i>Upgrade Locked</div>
                        <div class="xp-upgrade-sub">Reach <strong>${thresholdXP} XP</strong> (${thresholdPct}% of your XP Target) to unlock upgrade to <strong>${escapeHTML(nextLevel.rankName)}</strong>.<br>You're at ${Math.round(xp)} XP (${pct}%) — need ${Math.max(0, thresholdXP - Math.round(xp))} more XP.</div>
                    </div>
                </div>`;
        } else {
            upgradeHTML = `
                <div class="xp-upgrade-inner maxed">
                    <div class="xp-upgrade-left">
                        <div class="xp-upgrade-title">🏆 You're at the top of the ladder!</div>
                        <div class="xp-upgrade-sub">You've reached ${escapeHTML(level?.rankName || 'the highest rank')}. Congratulations!</div>
                    </div>
                </div>`;
        }
        upgradeCard.innerHTML = upgradeHTML;
        document.getElementById('requestUpgradeBtn')?.addEventListener('click', () => requestUpgrade(a.id));
    }
}

function requestUpgrade(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;
    if (!isUpgradeUnlocked(a)) return showToast('You need at least ' + getUpgradeThreshold(a) + '% progress to request an upgrade.', 'danger');
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
    // Seed the 12 default Pocket Financer ranks on first load (just a
    // starting point — admin/dev can add, edit, or delete levels freely).
    const wasEmpty = (state.levelDefs || []).length === 0;
    seedDefaultLevels();
    document.getElementById('addLevelBtn')?.addEventListener('click', () => showLevelFormModal());
    if (wasEmpty && typeof renderAll === 'function') renderAll();
}
