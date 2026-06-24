/* ============================================================
   agent-portal.js — Agent-facing "Agent Portal" experience
   ------------------------------------------------------------
   Ported from the standalone Agent Portal mockup, but rewired
   to read/write the REAL shared state (agentState, state.loans,
   state.sos, state.agentMarks) instead of fake in-memory data.
   No new storage wiring needed — everything rides on the same
   saveState()/loadState() Drive backend as the rest of the app.

   Rank/XP visuals reuse ranking.js (getAgentProgressPct, levels,
   leaderboard) rather than introducing a second rank system.
   ============================================================ */

/* ---------------- Shared small helpers ---------------- */

function apMyAgent() {
    if (state.user?.role !== 'agent') return null;
    return agentState.find(a => a.id === state.user.agentId) || null;
}

function apFmtMonthYear() {
    return new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// Loans belonging to the current agent (or a given agent id)
function apAgentLoans(agentId) {
    return state.loans.filter(l => l.agentId === agentId);
}

function apLoanedOutTotal(agentId) {
    return apAgentLoans(agentId)
        .filter(l => l.status !== 'Paid')
        .reduce((s, l) => s + (Number(l.principalOutstanding) || 0), 0);
}

function apInterestCollectedTotal(agentId) {
    return apAgentLoans(agentId).reduce((s, l) => s + (Number(l.interestPaidTotal) || 0), 0);
}

/* ============================================================
   DASHBOARD PANEL (agent-only block on page-dashboard)
   ============================================================ */

function renderAgentDashboardPanel() {
    const panel = document.getElementById('ap-dashboard-panel');
    if (!panel) return;
    const isAgent = state.user?.role === 'agent';
    panel.style.display = isAgent ? '' : 'none';
    if (!isAgent) return;

    const me = apMyAgent();
    if (!me) return;

    // me.fund = remaining undeployed balance (only decreases on issue, never recovers from collections)
    const fundBalance = round2(Number(me.fund) || 0);
    const loaned = apLoanedOutTotal(me.id);
    // Total in circulation = remaining fund + outstanding principal
    const allocated = round2(fundBalance + loaned);
    const available = fundBalance;   // "available to issue" is exactly what's left in the fund
    const pct = allocated > 0 ? Math.min(100, (loaned / allocated) * 100) : 0;
    const interest = apInterestCollectedTotal(me.id);
    const collectionPool = round2(Number(me.collectionPool) || 0);
    const progressPct = typeof getAgentProgressPct === 'function' ? getAgentProgressPct(me) : 0;
    const myXP = typeof getAgentXP === 'function' ? Math.round(getAgentXP(me)) : 0;
    const myXPTarget = typeof getAgentXPTarget === 'function' ? Math.round(getAgentXPTarget(me)) : 0;
    const nextLevel = typeof getNextLevel === 'function' ? getNextLevel(me) : null;

    document.getElementById('ap-m-allocated').textContent = fmtINR(allocated);
    document.getElementById('ap-m-loaned').textContent = fmtINR(loaned);
    document.getElementById('ap-m-available').textContent = fmtINR(available);
    document.getElementById('ap-m-progress').textContent = progressPct + '%';

    // Fund exhausted warning
    const fundWarningEl = document.getElementById('ap-m-fund-warning');
    if (fundWarningEl) fundWarningEl.style.display = fundBalance <= 0 ? '' : 'none';

    const _levelsConfigured = typeof sortedLevelDefs === 'function' && sortedLevelDefs().length > 0;
    document.getElementById('ap-m-progress-delta').innerHTML = !_levelsConfigured
        ? 'No ranks configured yet'
        : `${myXP} / ${myXPTarget} XP` + (nextLevel ? ' <span class="icon-em">↑</span>' + escapeHTML(nextLevel.name) : ' <span class="icon-em">🏆</span>Top of ladder');

    const myOpenTickets = state.sos.filter(t => apTicketAgentId(t) === me.id && apTicketStatus(t) !== 'Closed' && apTicketStatus(t) !== 'Resolved').length;
    document.getElementById('ap-m-tickets').textContent = myOpenTickets;

    document.getElementById('ap-budget-month').textContent = apFmtMonthYear();
    document.getElementById('ap-budget-allocated').textContent = fmtINR(allocated);
    document.getElementById('ap-budget-loaned').textContent = fmtINR(loaned);
    document.getElementById('ap-budget-available').textContent = fmtINR(available);
    document.getElementById('ap-budget-interest').textContent = fmtINR(interest);
    document.getElementById('ap-budget-pct-label').textContent = pct.toFixed(1) + '% deployed';
    document.getElementById('ap-budget-bar-fill').style.width = pct.toFixed(1) + '%';

    // Collection pool (principal + interest collected — separate from fund)
    const collectEl = document.getElementById('ap-budget-collection');
    if (collectEl) collectEl.textContent = fmtINR(collectionPool);

    // Collection income metric card
    const collectCardEl = document.getElementById('ap-m-collection');
    if (collectCardEl) collectCardEl.textContent = fmtINR(collectionPool);

    // Income stat card
    const incomeEl = document.getElementById('ap-m-income');
    const incomeDeltaEl = document.getElementById('ap-m-income-delta');
    if (incomeEl) {
        const earned = round2(Number(me.incomeEarned) || 0);
        incomeEl.textContent = fmtINR(earned);
        if (incomeDeltaEl) {
            const upgrades = (me.incomeHistory || []).length;
            incomeDeltaEl.textContent = upgrades > 0
                ? `From ${upgrades} rank upgrade${upgrades > 1 ? 's' : ''}`
                : 'Earned on rank upgrades';
        }
    }

    renderApLeaderboard(document.getElementById('ap-lb-list'));
    renderApRankCard();
}

function renderApLeaderboard(root) {
    if (!root || typeof buildLeaderboard !== 'function') return;
    const board = buildLeaderboard();
    if (!board.length) {
        root.innerHTML = '<p class="empty-row">No agents to rank yet.</p>';
        return;
    }
    root.innerHTML = board.slice(0, 8).map((row, i) => {
        const isMe = state.user?.role === 'agent' && row.agent.id === state.user.agentId;
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
        return `
        <div class="lb-row${isMe ? ' me' : ''}">
            <div class="lb-rank ${rankCls}">${medal}</div>
            <div class="lb-avatar" style="background:linear-gradient(135deg, var(--purple), #378ADD)">${escapeHTML(initials(row.agent.name))}</div>
            <div class="lb-info">
                <div class="lb-name">${escapeHTML(row.agent.name)}${isMe ? ' (You)' : ''}</div>
                <div class="lb-tier">${escapeHTML(row.level?.rankName || 'Unranked')}</div>
            </div>
            <div class="lb-xp-col">
                <div class="lb-xp-val">${row.pct}%</div>
                <div class="lb-xp-lbl">progress</div>
            </div>
        </div>`;
    }).join('');
}

function renderApRankCard() {
    const card = document.getElementById('ap-rank-card');
    if (!card) return;

    const me = apMyAgent();
    if (!me || typeof getAgentProgressPct !== 'function') {
        card.innerHTML = `
            <div class="rk-title">My Rank</div>
            <div class="rk-loading"><i class="fa-solid fa-ranking-star"></i><span>Loading rank…</span></div>`;
        return;
    }

    const pct         = getAgentProgressPct(me);
    const level       = getAgentCurrentLevel(me);
    const nextLevel   = getNextLevel(me);
    const allocated   = getAgentAllocated(me);
    const xp          = getAgentXP(me);
    const xpTarget    = getAgentXPTarget(me);
    const unlocked    = isUpgradeUnlocked(me);
    const req         = me.upgradeRequest;
    const threshold   = typeof getUpgradeThreshold === 'function' ? getUpgradeThreshold(me) : RANK_UPGRADE_THRESHOLD;
    const thresholdXP = xpTarget ? Math.round((threshold / 100) * xpTarget) : 0;

    // --- Tier colours & icons ---
    const TIERS = {
        'No Rank':     { icon: 'fa-ban',              color: '#9ca3af' },
        'Bronze':      { icon: 'fa-medal',            color: '#cd7f32' },
        'Silver':      { icon: 'fa-medal',            color: '#b0b8c1' },
        'Gold':        { icon: 'fa-medal',            color: '#f59e0b' },
        'Platinum':    { icon: 'fa-gem',              color: '#60a5fa' },
        'Diamond':     { icon: 'fa-gem',              color: '#a78bfa' },
        'Master':      { icon: 'fa-star',             color: '#fbbf24' },
        'Grand Master':{ icon: 'fa-star-half-stroke', color: '#f97316' },
        'Challenger':  { icon: 'fa-bolt',             color: '#f43f5e' },
        'Supreme':     { icon: 'fa-fire',             color: '#ef4444' },
        'Radiant':     { icon: 'fa-sparkles',         color: '#c084fc' },
        'Titan':       { icon: 'fa-crown',            color: '#fbbf24' },
    };
    const cur  = TIERS[level?.rankName]    || { icon: 'fa-circle', color: '#9ca3af' };
    const next = TIERS[nextLevel?.rankName] || { icon: 'fa-circle', color: '#6b7280' };

    // --- Bottom action strip ---
    let action = '';
    if (req?.status === 'verifying') {
        action = `
        <div class="rk-action verifying">
            <span>Verifying… <strong>${escapeHTML(getLevelById(req.levelId)?.rankName || 'next rank')}</strong></span>
            <span class="rk-countdown" data-countdown="${me.id}">${formatCountdown(req.verifyUntil - Date.now())}</span>
        </div>`;
    } else if (req?.status === 'pending_admin') {
        action = `
        <div class="rk-action pending">
            <i class="fa-solid fa-clock"></i>
            <span>Upgrade pending admin approval</span>
        </div>`;
    } else if (nextLevel && unlocked) {
        action = `
        <div class="rk-action ready">
            <div>
                <strong>Target reached! 🎉</strong>
                <span>You can now upgrade to <b>${escapeHTML(nextLevel.rankName)}</b></span>
            </div>
            <button class="rk-upgrade-btn" id="ap-upgrade-btn">
                <i class="fa-solid ${next.icon}"></i> Upgrade Now
            </button>
        </div>`;
    } else if (nextLevel) {
        action = `
        <div class="rk-action locked">
            <i class="fa-solid fa-lock"></i>
            <span>Earn <strong>${thresholdXP} XP</strong> to unlock upgrade to <strong>${escapeHTML(nextLevel.rankName)}</strong> (currently ${Math.round(xp)} XP)</span>
        </div>`;
    } else {
        action = `
        <div class="rk-action maxed">
            <i class="fa-solid fa-trophy"></i>
            <span>You've reached the highest rank — <strong>Titan</strong>!</span>
        </div>`;
    }

    card.innerHTML = `
        <div class="rk-header">
            <span class="rk-title">My Rank</span>
            <span class="rk-badge" style="background:${cur.color}20;color:${cur.color};border-color:${cur.color}40">
                <i class="fa-solid ${cur.icon}"></i> ${escapeHTML(level?.rankName || 'No Rank')}
            </span>
        </div>

        <div class="rk-body">
            <!-- Rank icon -->
            <div class="rk-icon" style="background:${cur.color}15;border:2px solid ${cur.color}40">
                <i class="fa-solid ${cur.icon}" style="color:${cur.color}"></i>
            </div>

            <!-- Progress section -->
            <div class="rk-progress-col">
                <div class="rk-rank-names">
                    <span class="rk-cur-name">${escapeHTML(level?.rankName || 'No Rank')}</span>
                    ${nextLevel ? `<span class="rk-arrow">→</span><span class="rk-next-name" style="color:${next.color}">${escapeHTML(nextLevel.rankName)}</span>` : '<span class="rk-top-label">Max Rank</span>'}
                </div>

                <div class="rk-bar-wrap">
                    <div class="rk-bar-track">
                        <div class="rk-bar-fill" style="width:${pct}%;background:${unlocked ? 'linear-gradient(90deg,#10b981,#34d399)' : `linear-gradient(90deg,${cur.color},${next.color})`}"></div>
                        <div class="rk-bar-threshold" style="left:${threshold}%" title="${threshold}% threshold"></div>
                    </div>
                    <span class="rk-pct ${unlocked ? 'unlocked' : ''}">${pct}%</span>
                </div>

                <div class="rk-amounts">
                    <span>${Math.round(xp)} XP earned</span>
                    <span>XP Target: ${Math.round(xpTarget)}</span>
                </div>

                ${(level?.benefits || []).length ? `
                <div class="benefit-chip-list">
                    ${level.benefits.map(b => `<span class="benefit-chip"><i class="fa-solid fa-check"></i>${escapeHTML(b)}</span>`).join('')}
                </div>` : ''}
            </div>
        </div>

        ${action}
    `;

    document.getElementById('ap-upgrade-btn')?.addEventListener('click', () => {
        requestUpgrade(me.id);
        renderApRankCard();
    });
}

/* ============================================================
   CLIENTS PAGE (agent-only — card view over real loan records)
   ============================================================ */

function renderClientsPage() {
    const me = apMyAgent();
    const wrap = document.getElementById('ap-client-cards-wrap');
    const empty = document.getElementById('ap-clients-empty-state');
    if (!wrap || !me) return;

    const fundBalance = round2(Number(me.fund) || 0);
    const loaned = apLoanedOutTotal(me.id);
    const allocated = round2(fundBalance + loaned);
    const available = fundBalance;
    let loans = apAgentLoans(me.id);

    document.getElementById('ap-cb-allocated').textContent = fmtINR(allocated);
    document.getElementById('ap-cb-loaned').textContent = fmtINR(loaned);
    document.getElementById('ap-cb-available').textContent = fmtINR(available);
    document.getElementById('ap-cb-clientcount').textContent = loans.length;

    const search = (document.getElementById('ap-client-search-input')?.value || '').trim().toLowerCase();
    if (search) {
        loans = loans.filter(l => (l.name || '').toLowerCase().includes(search) || (l.phone || '').includes(search));
    }

    if (!apAgentLoans(me.id).length) {
        wrap.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';

    if (!loans.length) {
        wrap.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);padding:28px">No clients match "${escapeHTML(search)}".</div>`;
        return;
    }

    wrap.innerHTML = '<div class="ap-client-grid">' + loans.map(l => {
        normaliseLoan(l);
        const statusClass = l.status === 'Active' ? 'ct-status-active' : l.status === 'Paid' ? 'ct-status-closed' : 'ct-status-overdue';
        const statusLabel = l.status === 'Overdue' ? 'Pending Interest' : l.status;
        return `
        <div class="ap-client-card">
            <div class="ap-client-card-top">
                <div class="ap-client-avatar">${escapeHTML(initials(l.name))}</div>
                <div style="flex:1;min-width:0">
                    <div class="ap-client-name">${escapeHTML(l.name)}</div>
                    <div class="ap-client-phone">${escapeHTML(l.phone || 'No phone')}</div>
                </div>
                <span class="ct-status-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="ap-client-stats">
                <div><small>Principal</small><strong>${fmtINR(l.amount)}</strong></div>
                <div><small>Outstanding</small><strong>${fmtINR(l.principalOutstanding)}</strong></div>
                <div><small>Due</small><strong>${l.dueDate || '—'}</strong></div>
            </div>
            ${l.interestOutstanding > 0 ? `<div class="ap-client-pending">Pending interest: ${fmtINR(l.interestOutstanding)}</div>` : ''}
            <div class="ap-client-actions">
                <button class="btn-friendly-secondary compact" data-ap-view="${l.id}"><i class="fa-solid fa-eye"></i> View</button>
                ${l.status !== 'Paid' ? `<button class="btn-friendly-primary compact" data-ap-pay="${l.id}"><i class="fa-solid fa-indian-rupee-sign"></i> Receive</button>` : ''}
            </div>
        </div>`;
    }).join('') + '</div>';

    wrap.querySelectorAll('[data-ap-view]').forEach(b => b.onclick = () => viewLoan(b.dataset.apView));
    wrap.querySelectorAll('[data-ap-pay]').forEach(b => b.onclick = () => repayLoan(b.dataset.apPay));
}

/* ============================================================
   SCHEDULE PAGE (agent-only calendar — real loan dates + marks)
   ============================================================ */

const AP_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const AP_DOT_COLOR = { 'loan-start': '#1D9E75', 'loan-due': '#E24B4A', 'agent': 'var(--purple)' };
const AP_TAG_LABEL = { 'loan-start': 'Loan Start', 'loan-due': 'Loan Due', 'agent': 'My Mark' };
const AP_TAG_CLASS = { 'loan-start': 'sched-tag-loan-start', 'loan-due': 'sched-tag-loan-due', 'agent': 'sched-tag-agent' };

let apCalViewYear = new Date().getFullYear();
let apCalViewMonth = new Date().getMonth();
let apCalSelected = null;
let apUpcomingFilter = 'all';

function apIsoDate(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function apTodayISO() { return new Date().toISOString().slice(0, 10); }

function apBuildCalendarEvents() {
    const me = apMyAgent();
    if (!me) return [];
    const events = [];
    apAgentLoans(me.id).forEach(l => {
        if (l.sanctionDate) {
            events.push({ date: l.sanctionDate.slice(0, 10), type: 'loan-start', label: escapeHTML(l.name) + ' — loan issued', sub: fmtINR(l.amount) });
        }
        if (l.dueDate && l.status !== 'Paid') {
            events.push({ date: l.dueDate, type: 'loan-due', label: escapeHTML(l.name) + ' — payment due', sub: fmtINR(l.principalOutstanding) + ' outstanding' });
        }
    });
    (state.agentMarks || []).filter(m => m.agentId === me.id).forEach(m => {
        events.push({ date: m.date, type: 'agent', label: escapeHTML(m.label), sub: m.note || '', markId: m.id });
    });
    return events;
}

function apEventsForDate(events, iso) {
    return events.filter(e => e.date === iso);
}

function renderSchedulePage() {
    const me = apMyAgent();
    if (!me) return;
    apRenderCalendar();
    apSyncSchedMetrics();
}

function apRenderCalendar() {
    const grid = document.getElementById('ap-cal-days-grid');
    if (!grid) return;
    const events = apBuildCalendarEvents();
    document.getElementById('ap-cal-month-label').textContent = AP_MONTHS[apCalViewMonth];
    document.getElementById('ap-cal-year-label').textContent = apCalViewYear;

    const today = apTodayISO();
    const firstDay = new Date(apCalViewYear, apCalViewMonth, 1).getDay();
    const daysInMonth = new Date(apCalViewYear, apCalViewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(apCalViewYear, apCalViewMonth, 0).getDate();

    let html = '';
    for (let i = 0; i < firstDay; i++) {
        const d = prevMonthDays - firstDay + 1 + i;
        const iso = apIsoDate(apCalViewMonth === 0 ? apCalViewYear - 1 : apCalViewYear, apCalViewMonth === 0 ? 11 : apCalViewMonth - 1, d);
        html += `<div class="cal-day cal-day-empty other-month" data-ap-day="${iso}"><div class="cal-day-num">${d}</div>${apRenderDots(apEventsForDate(events, iso))}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = apIsoDate(apCalViewYear, apCalViewMonth, d);
        let cls = 'cal-day';
        if (iso === today) cls += ' today';
        if (iso === apCalSelected) cls += ' selected';
        html += `<div class="${cls}" data-ap-day="${iso}"><div class="cal-day-num">${d}</div>${apRenderDots(apEventsForDate(events, iso))}</div>`;
    }
    const total = firstDay + daysInMonth;
    const trailingDays = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= trailingDays; d++) {
        const iso = apIsoDate(apCalViewMonth === 11 ? apCalViewYear + 1 : apCalViewYear, apCalViewMonth === 11 ? 0 : apCalViewMonth + 1, d);
        html += `<div class="cal-day cal-day-empty other-month" data-ap-day="${iso}"><div class="cal-day-num">${d}</div>${apRenderDots(apEventsForDate(events, iso))}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-ap-day]').forEach(el => {
        el.addEventListener('click', () => apSelectDay(el.dataset.apDay));
    });
    apRenderUpcoming(events);
}

function apRenderDots(evts) {
    if (!evts.length) return '<div class="cal-dots"></div>';
    const dots = evts.slice(0, 5).map(e => `<div class="cal-dot" style="background:${AP_DOT_COLOR[e.type] || '#888'}"></div>`).join('');
    return `<div class="cal-dots">${dots}</div>`;
}

function apSelectDay(iso) {
    apCalSelected = iso;
    apRenderCalendar();
    apRenderSelectedDay();
    const addDate = document.getElementById('ap-sched-add-date');
    if (addDate) addDate.value = iso;
}

function apRenderSelectedDay() {
    const header = document.getElementById('ap-sched-sel-header');
    const body = document.getElementById('ap-sched-sel-body');
    if (!header || !body) return;
    if (!apCalSelected) {
        header.textContent = 'Select a date to view events';
        body.innerHTML = '<div class="sched-sel-empty">Click any date on the calendar.</div>';
        return;
    }
    const events = apBuildCalendarEvents();
    const d = new Date(apCalSelected + 'T00:00:00');
    header.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const evts = apEventsForDate(events, apCalSelected);
    if (!evts.length) {
        body.innerHTML = '<div class="sched-sel-empty">No events on this date.<br>Use the form below to add a mark.</div>';
        return;
    }
    body.innerHTML = evts.map(e => `
        <div class="sched-event-item">
            <div class="sched-event-dot" style="background:${AP_DOT_COLOR[e.type]}"></div>
            <div style="flex:1">
                <div class="sched-event-label">${e.label}</div>
                ${e.sub ? `<div class="sched-event-sub">${e.sub}</div>` : ''}
            </div>
            <span class="sched-event-tag ${AP_TAG_CLASS[e.type]}">${AP_TAG_LABEL[e.type]}</span>
            ${e.type === 'agent' ? `<button data-ap-remove-mark="${e.markId}" style="margin-left:4px;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:13px" title="Remove">✕</button>` : ''}
        </div>`).join('');
    body.querySelectorAll('[data-ap-remove-mark]').forEach(b => b.onclick = () => apRemoveAgentMark(b.dataset.apRemoveMark));
}

function apAddAgentMark() {
    const me = apMyAgent();
    if (!me) return;
    const dateEl = document.getElementById('ap-sched-add-date');
    const labelEl = document.getElementById('ap-sched-add-label');
    const noteEl = document.getElementById('ap-sched-add-note');
    const res = document.getElementById('ap-sched-add-result');
    const date = dateEl.value;
    const label = labelEl.value.trim();
    if (!date || !label) {
        res.style.display = 'block';
        res.style.background = 'var(--danger-bg)';
        res.style.color = 'var(--danger-text)';
        res.textContent = 'Please select a date and enter a label.';
        return;
    }
    state.agentMarks = state.agentMarks || [];
    state.agentMarks.push({ id: genId('mark'), agentId: me.id, date, label, note: noteEl.value.trim() || '' });
    apCalSelected = date;
    apClearSchedForm();
    saveState();
    apRenderCalendar();
    apRenderSelectedDay();
    apSyncSchedMetrics();
    res.style.display = 'block';
    res.style.background = 'var(--success-bg)';
    res.style.color = 'var(--success-text)';
    res.textContent = '✓ Mark added for ' + new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '.';
    setTimeout(() => { res.style.display = 'none'; }, 3000);
    showToast('Custom mark added — ' + label, 'success');
}

function apRemoveAgentMark(id) {
    state.agentMarks = (state.agentMarks || []).filter(m => m.id !== id);
    saveState();
    apRenderCalendar();
    apRenderSelectedDay();
    apSyncSchedMetrics();
    showToast('Custom mark removed.', 'warning');
}

function apClearSchedForm() {
    document.getElementById('ap-sched-add-label').value = '';
    document.getElementById('ap-sched-add-note').value = '';
    document.getElementById('ap-sched-add-result').style.display = 'none';
}

function apRenderUpcoming(events) {
    const list = document.getElementById('ap-cal-upcoming-list');
    if (!list) return;
    const today = apTodayISO();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    let upcoming = events.filter(e => e.date >= today && e.date <= cutoffISO).sort((a, b) => a.date.localeCompare(b.date));
    if (apUpcomingFilter !== 'all') upcoming = upcoming.filter(e => e.type === apUpcomingFilter);

    const countLbl = document.getElementById('ap-upcoming-count-label');
    if (countLbl) countLbl.textContent = upcoming.length + ' event' + (upcoming.length !== 1 ? 's' : '') + ' · Next 30 days';

    if (!upcoming.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);font-size:12.5px;padding:24px 0">
            <div style="font-size:28px;margin-bottom:8px">📭</div>
            No ${apUpcomingFilter === 'all' ? '' : AP_TAG_LABEL[apUpcomingFilter] + ' '}events in the next 30 days.
        </div>`;
        return;
    }
    list.innerHTML = upcoming.map(e => {
        const d = new Date(e.date + 'T00:00:00');
        return `<div class="upcoming-item">
            <div class="upcoming-date-box" style="border-left:3px solid ${AP_DOT_COLOR[e.type] || '#888'}">
                <div class="upcoming-day">${d.getDate()}</div>
                <div class="upcoming-mon">${d.toLocaleDateString('en-IN', { month: 'short' })}</div>
            </div>
            <div class="upcoming-info">
                <div class="upcoming-label">${e.label}</div>
                <div class="upcoming-sub">${e.sub || AP_TAG_LABEL[e.type]}</div>
            </div>
            <span class="sched-event-tag ${AP_TAG_CLASS[e.type]}" style="font-size:10px">${AP_TAG_LABEL[e.type]}</span>
        </div>`;
    }).join('');
}

function apSyncSchedMetrics() {
    const events = apBuildCalendarEvents();
    const now = new Date();
    const thisMonth = now.getMonth(), thisYear = now.getFullYear();
    const inThisMonth = e => { const d = new Date(e.date + 'T00:00:00'); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; };
    document.getElementById('ap-sched-m-starts').textContent = events.filter(e => e.type === 'loan-start' && inThisMonth(e)).length;
    document.getElementById('ap-sched-m-dues').textContent = events.filter(e => e.type === 'loan-due').length;
    document.getElementById('ap-sched-m-agent').textContent = events.filter(e => e.type === 'agent').length;
    document.getElementById('ap-sched-m-total').textContent = events.length;
}

function initSchedulePage() {
    document.getElementById('ap-cal-prev')?.addEventListener('click', () => {
        apCalViewMonth--; if (apCalViewMonth < 0) { apCalViewMonth = 11; apCalViewYear--; } apRenderCalendar();
    });
    document.getElementById('ap-cal-next')?.addEventListener('click', () => {
        apCalViewMonth++; if (apCalViewMonth > 11) { apCalViewMonth = 0; apCalViewYear++; } apRenderCalendar();
    });
    document.getElementById('ap-cal-today')?.addEventListener('click', () => {
        const now = new Date();
        apCalViewYear = now.getFullYear(); apCalViewMonth = now.getMonth(); apCalSelected = apTodayISO();
        apRenderCalendar(); apRenderSelectedDay();
    });
    document.getElementById('ap-sched-add-btn')?.addEventListener('click', apAddAgentMark);
    document.getElementById('ap-sched-clear-btn')?.addEventListener('click', apClearSchedForm);
    document.querySelectorAll('#ap-filter-chips-row .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            apUpcomingFilter = chip.dataset.apFilter;
            document.querySelectorAll('#ap-filter-chips-row .filter-chip').forEach(c => c.classList.remove('fc-active-all', 'fc-active-start', 'fc-active-due', 'fc-active-agent'));
            const cls = apUpcomingFilter === 'loan-start' ? 'fc-active-start' : apUpcomingFilter === 'loan-due' ? 'fc-active-due' : apUpcomingFilter === 'agent' ? 'fc-active-agent' : 'fc-active-all';
            chip.classList.add(cls);
            apRenderUpcoming(apBuildCalendarEvents());
        });
    });
    document.getElementById('ap-new-client-btn')?.addEventListener('click', () => document.getElementById('addLoanBtn')?.click());
}

/* ============================================================
   TICKETS (formerly "SOS Requests") — backed by state.sos
   Agent: raise + track own tickets. Admin/Dev: see all, reply,
   change status. Legacy SOS entries (just {reason, status}) are
   normalised on read so old data keeps working.
   ============================================================ */

const AP_TK_STATUS_LABEL = { Open: 'Open', 'In Progress': 'In Progress', Resolved: 'Resolved', Closed: 'Closed' };
const AP_TK_STATUS_CLASS = { Open: 'tk-status-open', 'In Progress': 'tk-status-inprogress', Resolved: 'tk-status-resolved', Closed: 'tk-status-closed' };
const AP_TK_CAT_LABEL = { payment: 'Payment', kyc: 'KYC / Document', loan: 'Loan Related', technical: 'Technical', other: 'Other' };
const AP_TK_CAT_CLASS = { payment: 'tk-cat-payment', kyc: 'tk-cat-kyc', loan: 'tk-cat-loan', technical: 'tk-cat-technical', other: 'tk-cat-other' };
const AP_TK_PRIO_LABEL = { high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority' };
const AP_TK_PRIO_CLASS = { high: 'tk-prio-high', medium: 'tk-prio-medium', low: 'tk-prio-low' };

let apTicketFilter = 'all';
let apSelectedTicketId = null;

// Normalises a legacy or new ticket so every field used by the UI exists.
function apNormaliseTicket(t) {
    if (!t.title) t.title = t.reason || 'Untitled issue';
    if (!t.category) t.category = 'other';
    if (!t.priority) t.priority = 'medium';
    if (!t.status) t.status = 'Open';
    // legacy statuses were lowercase free text — coerce to the canonical set
    const known = ['Open', 'In Progress', 'Resolved', 'Closed'];
    if (!known.includes(t.status)) t.status = 'Open';
    if (!t.timeline) {
        t.timeline = [{ type: 'submitted', msg: t.reason ? ('Ticket raised: ' + t.reason) : 'Ticket submitted.', time: t.raisedOn || Date.now(), from: 'agent' }];
    }
    return t;
}

function apTicketStatus(t) { apNormaliseTicket(t); return t.status; }
function apTicketAgentId(t) { return t.agentId || null; }

function apTicketsForCurrentUser() {
    state.sos.forEach(apNormaliseTicket);
    if (state.user?.role === 'agent') {
        return state.sos.filter(t => t.agentId === state.user.agentId);
    }
    return state.sos; // admin/developer see all
}

function apTkTimeLabel(ms) {
    return new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------------- Raise ticket modal ---------------- */

function apOpenRaiseTicketModal() {
    ['ap-tk-f-title', 'ap-tk-f-desc', 'ap-tk-f-ref'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('ap-tk-f-category').value = 'payment';
    document.getElementById('ap-tk-f-priority').value = 'medium';
    document.getElementById('ap-tk-raise-modal-overlay').style.display = 'flex';
}
function apCloseRaiseTicketModal() {
    document.getElementById('ap-tk-raise-modal-overlay').style.display = 'none';
}

function apSubmitTicket() {
    const title = document.getElementById('ap-tk-f-title').value.trim();
    const desc = document.getElementById('ap-tk-f-desc').value.trim();
    if (!title) return showToast('Please enter an issue title.', 'danger');
    if (!desc) return showToast('Please describe the issue.', 'danger');
    const category = document.getElementById('ap-tk-f-category').value;
    const priority = document.getElementById('ap-tk-f-priority').value;
    const ref = document.getElementById('ap-tk-f-ref').value.trim();
    const me = apMyAgent();

    const ticket = {
        id: genId('sos'),
        agentId: me ? me.id : null,
        agentName: me ? me.name : (state.user?.username || 'Unknown'),
        title, reason: title, desc, category, priority, ref,
        status: 'Open',
        raisedOn: Date.now(),
        timeline: [{ type: 'submitted', msg: 'Ticket submitted to Hiring Authority.', time: Date.now(), from: 'agent' }]
    };
    state.sos.unshift(ticket);
    apCloseRaiseTicketModal();
    apSelectedTicketId = ticket.id;
    addAudit('Ticket raised', `${ticket.agentName} raised ticket "${title}"`);
    saveState();
    renderTicketsPage();
    showToast('Ticket submitted. Hiring Authority notified.', 'success');
}

/* ---------------- Filter + render ---------------- */

function apSetTicketFilter(type, el) {
    apTicketFilter = type;
    document.querySelectorAll('#ap-tk-filter-chips .filter-chip').forEach(c => c.classList.remove('fc-active-all'));
    document.querySelectorAll('#ap-tk-filter-chips .filter-chip').forEach(c => c.style.background = '');
    if (el) el.classList.add('fc-active-all');
    renderTicketsPage();
}

function renderTicketsPage() {
    const container = document.getElementById('ap-tk-list-container');
    if (!container) return;
    const isAdmin = ['admin', 'developer'].includes(state.user?.role);
    const all = apTicketsForCurrentUser();
    const statusMap = { all: null, open: 'Open', inprogress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
    const wanted = statusMap[apTicketFilter];
    const filtered = wanted ? all.filter(t => t.status === wanted) : all;

    apSyncTicketMetrics(all);
    apUpdateTicketNavBadge(all);

    if (!all.length) {
        container.innerHTML = `
            <div class="tk-list-empty">
                <div style="font-size:40px;margin-bottom:12px">🎫</div>
                <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px">No Tickets Yet</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">${isAdmin ? 'No agent has raised a ticket yet.' : 'Raise a ticket whenever you face an issue.<br>The Hiring Authority will respond shortly.'}</div>
                ${isAdmin ? '' : '<button class="btn-primary" id="ap-tk-raise-first-btn"><span class="icon-em">＋</span> Raise Your First Ticket</button>'}
            </div>`;
        document.getElementById('ap-tk-raise-first-btn')?.addEventListener('click', apOpenRaiseTicketModal);
        document.getElementById('ap-tk-detail-panel').innerHTML = `<div class="tk-detail-empty"><div class="tk-detail-empty-icon">🎫</div><div style="font-size:14px;font-weight:600;color:var(--text-primary)">No tickets</div></div>`;
        return;
    }
    if (!filtered.length) {
        container.innerHTML = `<div class="tk-list-empty"><div style="font-size:32px;margin-bottom:10px">📭</div><div style="font-size:14px;font-weight:600;color:var(--text-primary)">No matching tickets</div></div>`;
        return;
    }

    container.innerHTML = '<div class="tk-list">' + filtered.map(t => {
        const isSelected = t.id === apSelectedTicketId;
        return `<div class="tk-card${isSelected ? ' tk-selected' : ''}" data-ap-tk-select="${t.id}">
            <div class="tk-card-top">
                <span class="tk-id-badge">${escapeHTML(String(t.id).slice(-6).toUpperCase())}</span>
                <div class="tk-title">${escapeHTML(t.title)}</div>
                <span class="tk-status-pill ${AP_TK_STATUS_CLASS[t.status]}">${AP_TK_STATUS_LABEL[t.status]}</span>
            </div>
            <div class="tk-desc-preview">${escapeHTML(t.desc || t.reason || '')}</div>
            <div class="tk-meta">
                <div class="tk-priority-dot ${AP_TK_PRIO_CLASS[t.priority] || 'tk-prio-medium'}"></div>
                ${isAdmin ? `<span style="font-size:11px;font-weight:600;color:var(--text-secondary)">${escapeHTML(t.agentName || 'Unknown agent')}</span>` : ''}
                <span class="tk-cat-tag ${AP_TK_CAT_CLASS[t.category] || 'tk-cat-other'}">${AP_TK_CAT_LABEL[t.category] || t.category}</span>
                <span class="tk-date">${apTkTimeLabel(t.raisedOn)}</span>
            </div>
        </div>`;
    }).join('') + '</div>';

    container.querySelectorAll('[data-ap-tk-select]').forEach(el => el.addEventListener('click', () => {
        apSelectedTicketId = el.dataset.apTkSelect;
        renderTicketsPage();
    }));

    if (apSelectedTicketId) {
        const t = all.find(tk => tk.id === apSelectedTicketId);
        if (t) apRenderTicketDetail(t); else document.getElementById('ap-tk-detail-panel').innerHTML = '';
    }
}

function apRenderTicketDetail(t) {
    const panel = document.getElementById('ap-tk-detail-panel');
    if (!panel) return;
    panel.classList.add('has-content'); // show on mobile
    const isAdmin = ['admin', 'developer'].includes(state.user?.role);

    const tlHtml = t.timeline.map(item => {
        const isReply = item.from === 'admin';
        return `<div class="tk-tl-item">
            <div class="tk-tl-dot" style="background:${isReply ? 'var(--success)' : 'var(--purple)'};color:#fff">${isReply ? '🏢' : '👤'}</div>
            <div class="tk-tl-content">
                ${isReply ? `<div class="tk-reply-bubble"><div class="tk-reply-from">🏢 Hiring Authority</div>${escapeHTML(item.msg)}</div>` : `<div class="tk-tl-msg">${escapeHTML(item.msg)}</div>`}
                <div class="tk-tl-time">${apTkTimeLabel(item.time)}</div>
            </div>
        </div>`;
    }).join('');

    let actionsHtml = '';
    if (isAdmin) {
        actionsHtml = `
            <div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)">
                <div class="tk-section-label" style="margin-top:0">Reply to Agent</div>
                <textarea class="form-input" id="ap-tk-reply-text" rows="2" placeholder="Type your response…" style="margin-bottom:8px"></textarea>
                <div style="display:flex;gap:8px">
                    <button class="btn-friendly-primary compact" data-ap-tk-reply="${t.id}" style="flex:1"><i class="fa-solid fa-reply"></i> Send Reply</button>
                    <select class="form-input" id="ap-tk-status-select" style="max-width:160px">
                        ${Object.keys(AP_TK_STATUS_LABEL).map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${AP_TK_STATUS_LABEL[s]}</option>`).join('')}
                    </select>
                </div>
            </div>`;
    } else if (t.status !== 'Closed') {
        actionsHtml = `
            <div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)">
                <div class="tk-section-label" style="margin-top:0">Add a Follow-up Note</div>
                <textarea class="form-input" id="ap-tk-followup-text" rows="2" placeholder="Add more details or a follow-up message…" style="margin-bottom:8px"></textarea>
                <button class="btn-primary" style="width:100%" data-ap-tk-followup="${t.id}"><span class="icon-em">📨</span> Send Follow-up</button>
            </div>
            ${t.status === 'Resolved' ? `<div style="margin-top:10px"><button class="btn-secondary" style="width:100%" data-ap-tk-close="${t.id}"><span class="icon-em">✓</span> Close Ticket</button></div>` : ''}`;
    } else if (!isAdmin) {
        actionsHtml = `<div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)"><button class="btn-secondary" style="width:100%" data-ap-tk-reopen="${t.id}"><span class="icon-em">↺</span> Reopen Ticket</button></div>`;
    }

    panel.innerHTML = `
        <div class="tk-detail-head">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span class="tk-id-badge">${escapeHTML(String(t.id).slice(-6).toUpperCase())}</span>
                <span class="tk-status-pill ${AP_TK_STATUS_CLASS[t.status]}">${AP_TK_STATUS_LABEL[t.status]}</span>
            </div>
            <div class="tk-detail-title">${escapeHTML(t.title)}</div>
            <div class="tk-detail-meta">
                ${isAdmin ? `<span style="font-size:12px;font-weight:600;color:var(--text-primary)">${escapeHTML(t.agentName || 'Unknown agent')}</span>` : ''}
                <span class="tk-cat-tag ${AP_TK_CAT_CLASS[t.category] || 'tk-cat-other'}">${AP_TK_CAT_LABEL[t.category] || t.category}</span>
                <div class="tk-priority-dot ${AP_TK_PRIO_CLASS[t.priority] || 'tk-prio-medium'}" style="width:8px;height:8px"></div>
                <span style="font-size:11px;color:var(--text-secondary)">${AP_TK_PRIO_LABEL[t.priority] || ''}</span>
                <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">${apTkTimeLabel(t.raisedOn)}</span>
            </div>
        </div>
        <div class="tk-detail-body">
            <div class="tk-section-label">Description</div>
            <div class="tk-desc-full">${escapeHTML(t.desc || t.reason || '')}</div>
            ${t.ref ? `<div class="tk-section-label">Reference</div><div style="font-size:13px;font-weight:600;color:var(--text-primary);background:var(--bg-secondary);padding:9px 12px;border-radius:var(--radius-md);border:0.5px solid var(--border)">${escapeHTML(t.ref)}</div>` : ''}
            <div class="tk-section-label">Activity Timeline</div>
            <div class="tk-timeline">${tlHtml}</div>
            ${actionsHtml}
        </div>`;

    panel.querySelector(`[data-ap-tk-reply]`)?.addEventListener('click', () => apSendTicketReply(t.id));
    panel.querySelector(`[data-ap-tk-followup]`)?.addEventListener('click', () => apSendTicketFollowup(t.id));
    panel.querySelector(`[data-ap-tk-close]`)?.addEventListener('click', () => apSetTicketStatus(t.id, 'Closed', 'closed', 'agent'));
    panel.querySelector(`[data-ap-tk-reopen]`)?.addEventListener('click', () => apSetTicketStatus(t.id, 'Open', 'reopened', 'agent'));
}

function apFindTicket(id) { return state.sos.find(t => t.id === id); }

function apSendTicketReply(id) {
    const t = apFindTicket(id);
    if (!t) return;
    const textEl = document.getElementById('ap-tk-reply-text');
    const msg = textEl ? textEl.value.trim() : '';
    const statusSel = document.getElementById('ap-tk-status-select');
    const newStatus = statusSel ? statusSel.value : t.status;
    if (msg) t.timeline.push({ type: 'reply', msg, time: Date.now(), from: 'admin' });
    if (newStatus !== t.status) {
        t.timeline.push({ type: 'status', msg: `Status changed to ${AP_TK_STATUS_LABEL[newStatus]}.`, time: Date.now(), from: 'admin' });
        t.status = newStatus;
    }
    if (!msg && newStatus === t.status) return showToast('Enter a reply or change the status first.', 'danger');
    addAudit('Ticket replied', `Replied to ticket from ${t.agentName || 'agent'}`);
    saveState();
    renderTicketsPage();
    showToast('Reply sent to agent.', 'success');
}

function apSendTicketFollowup(id) {
    const t = apFindTicket(id);
    if (!t) return;
    const textEl = document.getElementById('ap-tk-followup-text');
    const msg = textEl ? textEl.value.trim() : '';
    if (!msg) return showToast('Please enter a follow-up message.', 'danger');
    t.timeline.push({ type: 'followup', msg, time: Date.now(), from: 'agent' });
    if (t.status === 'Resolved') { t.status = 'In Progress'; t.timeline.push({ type: 'status', msg: 'Reopened with a follow-up.', time: Date.now(), from: 'agent' }); }
    saveState();
    renderTicketsPage();
    showToast('Follow-up sent to Hiring Authority.', 'success');
}

function apSetTicketStatus(id, status, eventType, from) {
    const t = apFindTicket(id);
    if (!t) return;
    t.status = status;
    t.timeline.push({ type: eventType, msg: `Ticket ${status.toLowerCase()} by ${from === 'agent' ? 'agent' : 'Hiring Authority'}.`, time: Date.now(), from });
    saveState();
    renderTicketsPage();
    showToast(`Ticket ${status.toLowerCase()}.`, status === 'Closed' ? 'warning' : 'info');
}

function apSyncTicketMetrics(all) {
    const open = all.filter(t => t.status === 'Open').length;
    const inprog = all.filter(t => t.status === 'In Progress').length;
    const resolved = all.filter(t => t.status === 'Resolved').length;
    const total = all.length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ap-tk-m-open', open);
    set('ap-tk-m-inprog', inprog);
    set('ap-tk-m-resolved', resolved);
    set('ap-tk-m-total', total);
}

function apUpdateTicketNavBadge(all) {
    const scoped = state.user?.role === 'agent' ? all : state.sos.filter(apNormaliseTicket);
    const open = scoped.filter(t => t.status === 'Open' || t.status === 'In Progress').length;
    updateBadge('sosBadge', open);
}

function initTicketsPage() {
    document.getElementById('ap-tk-raise-btn')?.addEventListener('click', apOpenRaiseTicketModal);
    document.getElementById('ap-tk-raise-close')?.addEventListener('click', apCloseRaiseTicketModal);
    document.getElementById('ap-tk-raise-cancel')?.addEventListener('click', apCloseRaiseTicketModal);
    document.getElementById('ap-tk-raise-submit')?.addEventListener('click', apSubmitTicket);
    document.getElementById('ap-tk-raise-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'ap-tk-raise-modal-overlay') apCloseRaiseTicketModal();
    });
    document.querySelectorAll('#ap-tk-filter-chips .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            apTicketFilter = chip.dataset.apTkFilter;
            document.querySelectorAll('#ap-tk-filter-chips .filter-chip').forEach(c => c.classList.remove('fc-active-all'));
            chip.classList.add('fc-active-all');
            renderTicketsPage();
        });
    });
}

/* ---------------- WIRING ---------------- */

function initAgentPortal() {
    initSchedulePage();
    initTicketsPage();
    renderAgentDashboardPanel();
}
