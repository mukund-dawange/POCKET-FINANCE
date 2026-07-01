// withdrawal.js
// XP Withdrawal module — extracted from ranking.js
// Depends on: state.js (state, agentState, saveState, addAudit, genId)
//             ui.js    (showToast, fmtINR)
//             ranking.js (getAgentRedeemPreview, XP_REDEEM_MINIMUM, XP_COOLDOWN_HOURS,
//                         addNotification, formatCountdown, renderMyRankPage)
//             wallet.js  (round2, escapeHTML)

// ─── Withdrawal history: receipt-style card rendering ───────────────────────

// Human-friendly order number for display purposes, e.g. WD20260701083012482
function formatWithdrawalOrderNumber(id, dateMs) {
    const d = new Date(dateMs || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const suffix = String(id || '').split('_').pop() || String(Math.floor(Math.random() * 100000));
    return `WD${stamp}${suffix}`;
}

function copyWithdrawalOrderNumber(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('Order number copied.', 'success'))
            .catch(() => showToast('Could not copy — please copy it manually.', 'warning'));
    } else {
        showToast('Could not copy — please copy it manually.', 'warning');
    }
}

// Renders a single withdrawal entry (pending request OR completed
// redeemHistory record) as a receipt-style card: badge + status, then
// Amount, XP, Type, Time, and Order number rows.
function buildWithdrawalHistoryCardHTML(entry) {
    const isPending = !!entry.status && entry.status !== 'paid';
    const isOverdue = isPending && entry.payBefore && (entry.payBefore - Date.now()) < 0;
    const statusLabel = isPending ? (isOverdue ? 'Overdue' : 'Pending') : 'Completed';
    const statusColor = isPending ? (isOverdue ? 'var(--danger)' : 'var(--warning)') : 'var(--success)';
    const methodLabel = { upi: 'UPI', bank: 'Bank Card' }[entry.method] || 'UPI';
    const timeMs = entry.date || entry.paidAt || entry.requestedAt || Date.now();
    const timeLabel = new Date(timeMs).toLocaleString('en-IN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const orderNumber = formatWithdrawalOrderNumber(entry.id, entry.requestedAt || timeMs);
    const xpAmount = Number(entry.xpRedeemed || 0);

    return `
        <div class="wd-history-card">
            <div class="wd-history-top">
                <span class="wd-badge">Withdraw</span>
                <span class="wd-status" style="color:${statusColor};">${statusLabel}</span>
            </div>
            <div class="wd-row wd-row-highlight">
                <span>Amount</span>
                <strong>${fmtINR(entry.money || 0)}</strong>
            </div>
            <div class="wd-row">
                <span>XP</span>
                <strong>${xpAmount.toLocaleString('en-IN')} XP</strong>
            </div>
            <div class="wd-row">
                <span>Type</span>
                <strong>${methodLabel}</strong>
            </div>
            <div class="wd-row">
                <span>Time</span>
                <strong>${timeLabel}</strong>
            </div>
            <div class="wd-row">
                <span>Order number</span>
                <span class="wd-order-value">
                    ${orderNumber}
                    <button type="button" class="wd-copy-btn" onclick="copyWithdrawalOrderNumber('${orderNumber}')" title="Copy order number"><i class="fa-regular fa-copy"></i></button>
                </span>
            </div>
        </div>`;
}

// ─── Agent: request an XP withdrawal ────────────────────────────────────────
function redeemAgentXP(agentId) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;

    // Block if there is already a pending/cooldown redeem request
    if (a.xpRedeemRequest && a.xpRedeemRequest.status !== 'paid') {
        return showToast('You already have a pending XP withdrawal request.', 'warning');
    }

    const preview = getAgentRedeemPreview(a);
    if (preview.xp < XP_REDEEM_MINIMUM || preview.redeemableXP <= 0) {
        return showToast(`Earn at least ${XP_REDEEM_MINIMUM.toLocaleString('en-IN')} XP before redeeming.`, 'warning');
    }

    if (!confirm(`Request withdrawal of ${preview.redeemableXP.toLocaleString('en-IN')} XP for ${fmtINR(preview.money)}?\n\nA 48-hour processing period will begin. Admin will be notified and will mark payment once sent.`)) return;

    // Deduct from Balance XP immediately and create a pending request.
    // NEVER touch a.xp here — that's rank-progress XP, not the wallet.
    a.balanceXP = preview.remainingXP;
    a.xpRedeemRequest = {
        id: genId('xpr'),
        requestedAt: Date.now(),
        payBefore: Date.now() + XP_COOLDOWN_HOURS * 60 * 60 * 1000,
        xpRedeemed: preview.redeemableXP,
        money: preview.money,
        xpBefore: preview.xp + preview.redeemableXP, // original xp
        xpAfter: preview.remainingXP,
        status: 'pending'   // 'pending' | 'paid'
    };

    // Push into global xpRedeemRequests list on state so admin/dev can see all
    state.xpRedeemRequests = state.xpRedeemRequests || [];
    state.xpRedeemRequests.unshift({
        id: a.xpRedeemRequest.id,
        agentId: a.id,
        agentName: a.name,
        requestedAt: a.xpRedeemRequest.requestedAt,
        payBefore: a.xpRedeemRequest.payBefore,
        xpRedeemed: preview.redeemableXP,
        money: preview.money,
        status: 'pending'
    });

    addAudit('XP withdrawal requested', `${a.name} requested withdrawal of ${preview.redeemableXP} XP for ${fmtINR(preview.money)} — pending admin payment`);
    addNotification(
        '💸 XP Withdrawal Request',
        `${a.name} requested a payout of ${fmtINR(preview.money)}. Please send the payment and mark it as done.`,
        ['admin', 'developer'],
        '💸'
    );
    saveState();
    renderMyRankPage();
    renderXPWithdrawalRequestsPanel();
    updateXPWithdrawalBadge();
    if (typeof renderAgentDashboardPanel === 'function') renderAgentDashboardPanel();
    if (typeof renderAgentWalletPage === 'function') renderAgentWalletPage();
    showToast(`Withdrawal request submitted! Admin will process ${fmtINR(preview.money)} within 48 hours.`, 'success');
}

// ─── Admin/Dev: mark an XP withdrawal as paid ───────────────────────────────
function markXPRedeemPaid(requestId) {
    const req = (state.xpRedeemRequests || []).find(r => r.id === requestId);
    if (!req || req.status === 'paid') return;
    if (!confirm(`Mark payment of ${fmtINR(req.money)} to ${req.agentName} as DONE?`)) return;

    req.status = 'paid';
    req.paidAt = Date.now();

    // Also update the agent's own record and history
    const a = agentState.find(x => x.id === req.agentId);
    if (a) {
        if (a.xpRedeemRequest && a.xpRedeemRequest.id === requestId) {
            a.xpRedeemRequest.status = 'paid';
            a.xpRedeemRequest.paidAt = Date.now();
        }
        a.incomeEarned = round2((Number(a.incomeEarned) || 0) + req.money);
        a.redeemedIncome = round2((Number(a.redeemedIncome) || 0) + req.money);
        a.redeemHistory = a.redeemHistory || [];
        a.redeemHistory.unshift({
            id: req.id,
            date: Date.now(),
            requestedAt: req.requestedAt || Date.now(),
            xpBefore: req.xpBefore || (req.xpRedeemed + (req.xpAfter || 0)),
            xpRedeemed: req.xpRedeemed,
            money: req.money,
            xpAfter: req.xpAfter || 0,
            method: req.method || 'upi',
            paidByAdmin: true
        });
    }

    addAudit('XP withdrawal paid', `Payment of ${fmtINR(req.money)} marked as done for ${req.agentName}`);
    addNotification(
        '✅ Payment Received!',
        `Your XP withdrawal of ${fmtINR(req.money)} has been sent. Check your account!`,
        [`agent:${req.agentId}`],
        '✅'
    );
    saveState();
    renderXPWithdrawalRequestsPanel();
    renderMyRankPage();
    updateXPWithdrawalBadge();
    if (typeof renderAgentWalletPage === 'function') renderAgentWalletPage();
    showToast(`Payment to ${req.agentName} marked as done ✅`, 'success');
}

// ─── Badge: update pending-count indicators ──────────────────────────────────
function updateXPWithdrawalBadge() {
    const pending = (state.xpRedeemRequests || []).filter(r => r.status === 'pending').length;
    const badge = document.getElementById('xpWithdrawalBadge');
    const sidebarBadge = document.getElementById('xpSidebarBadge');
    const agentWalletBadge = document.getElementById('agentWalletBadge');
    [badge, sidebarBadge].forEach(el => {
        if (!el) return;
        el.textContent = pending;
        el.style.display = pending > 0 ? '' : 'none';
    });
    // Agent's own wallet badge only reflects THEIR pending request, not the global admin count.
    if (agentWalletBadge) {
        const me = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;
        const mine = !!(me && me.xpRedeemRequest && me.xpRedeemRequest.status !== 'paid');
        agentWalletBadge.textContent = mine ? '1' : '0';
        agentWalletBadge.style.display = mine ? '' : 'none';
    }
}

// ─── Panel: render the withdrawal requests list ──────────────────────────────
function renderXPWithdrawalRequestsPanel() {
    const root = document.getElementById('xpWithdrawalRequestsList');
    if (!root) return;

    const requests = (state.xpRedeemRequests || []).slice().sort((a, b) => {
        // pending first, then by date desc
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return b.requestedAt - a.requestedAt;
    });

    if (!requests.length) {
        root.innerHTML = '<p class="empty-row">No XP withdrawal requests yet.</p>';
        return;
    }

    const isAdminOrDev = ['admin', 'developer'].includes(state.user?.role);

    root.innerHTML = requests.slice(0, 30).map(req => {
        const isPending = req.status === 'pending';
        const timeLeft = req.payBefore - Date.now();
        const isOverdue = timeLeft < 0;
        const timeLabel = isPending
            ? (isOverdue
                ? `<span style="color:var(--danger);font-weight:700;">⚠️ Overdue by ${formatCountdown(Math.abs(timeLeft))}</span>`
                : `<span style="color:var(--warning);">⏱ Pay within ${formatCountdown(timeLeft)}</span>`)
            : `<span style="color:var(--success);">✅ Paid ${new Date(req.paidAt || req.requestedAt).toLocaleDateString('en-IN')}</span>`;

        return `
        <div class="request-row xp-withdraw-row" style="border-left:3px solid ${isPending ? (isOverdue ? 'var(--danger)' : 'var(--warning)') : 'var(--success)'};">
            <div class="request-row-info">
                <strong>${escapeHTML(req.agentName)}</strong>
                <span style="margin-left:8px;font-size:12px;background:${isPending ? 'var(--warning-bg,#fef3c7)' : 'var(--success-bg)'};color:${isPending ? '#92400e' : 'var(--success)'};padding:2px 8px;border-radius:20px;font-weight:600;">${isPending ? 'Pending' : 'Paid'}</span>
                <small style="display:block;margin-top:4px;">${req.xpRedeemed.toLocaleString('en-IN')} XP → <strong>${fmtINR(req.money)}</strong> · Requested ${new Date(req.requestedAt).toLocaleString('en-IN')}</small>
                <small>${timeLabel}</small>
            </div>
            <div class="request-row-actions">
                ${isAdminOrDev && isPending ? `<button class="btn-friendly-primary compact" data-pay-xp="${req.id}"><i class="fa-solid fa-check"></i> Mark Payment Done</button>` : ''}
            </div>
        </div>`;
    }).join('');

    root.querySelectorAll('[data-pay-xp]').forEach(b => b.onclick = () => markXPRedeemPaid(b.dataset.payXp));
}

// ─── Withdrawal UI: method selection, preset amounts, submit ─────────────────

let _withdrawalMethod = 'upi';

// ─── Daily withdrawal limit: agents may withdraw once per calendar day ─────
const DAILY_WITHDRAWAL_LIMIT = 1;

function getTodayDateStr() {
    return new Date().toDateString();
}

function hasReachedDailyWithdrawalLimit(agent) {
    return !!(agent && agent.lastWithdrawalDate === getTodayDateStr());
}

function getDailyWithdrawalRemaining(agent) {
    return hasReachedDailyWithdrawalLimit(agent) ? 0 : DAILY_WITHDRAWAL_LIMIT;
}

function selectWithdrawalMethod(method) {
    _withdrawalMethod = method;
    document.querySelectorAll('.withdrawal-method-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.method === method);
    });
    const badge = document.getElementById('withdrawalAccountBadge');
    const nameEl = document.getElementById('withdrawalAccountName');
    const subEl = document.getElementById('withdrawalAccountSub');
    if (!badge || !nameEl || !subEl) return;

    const a = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;

    if (method === 'upi') {
        badge.textContent = 'UPI»';
        nameEl.textContent = (a && a.upiName) ? a.upiName : (a ? a.name : 'Your Name');
        subEl.textContent = (a && a.upiId) ? a.upiId : 'Set your UPI ID';
    } else if (method === 'bank') {
        // Prefer bank details already saved in the agent's Profile & KYC —
        // falls back to a wallet-only override if they've set one there,
        // so the agent doesn't have to type the same details twice.
        const bankAcc = (a && (a.bankAccount || a.kyc?.bankAcc)) || '';
        const bankHolder = (a && (a.bankName || a.kyc?.name)) || (a ? a.name : 'Your Name');
        const ifsc = (a && a.kyc?.ifsc) || '';
        badge.textContent = 'BANK';
        nameEl.textContent = bankHolder;
        subEl.textContent = bankAcc ? (ifsc ? `${bankAcc} · IFSC ${ifsc}` : bankAcc) : 'Set your bank account';
    }
}

let _withdrawalXP = 0;

function selectWithdrawalPreset(val) {
    // val is in ₹; store XP equivalent (val * 2) — no typing allowed, selection only
    document.querySelectorAll('.withdrawal-preset-btn').forEach(b => {
        b.classList.toggle('active', Number(b.dataset.preset) === val);
    });
    _withdrawalXP = val * 2;
    refreshWithdrawalAmount();
}

function refreshWithdrawalAmount() {
    const xpVal = _withdrawalXP;
    const rupeesVal = xpVal / 2;
    const valueEl = document.getElementById('withdrawalAmtValue');
    const recv = document.getElementById('withdrawalAmtReceived');
    const btn = document.getElementById('withdrawalSubmitBtn');
    if (valueEl) {
        valueEl.textContent = xpVal > 0 ? xpVal.toLocaleString('en-IN') : 'Select an amount above';
        valueEl.classList.toggle('selected', xpVal > 0);
    }
    if (recv) recv.textContent = '₹' + rupeesVal.toFixed(2);
    if (btn) {
        const a = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;
        const canProceed = xpVal > 0 && !hasReachedDailyWithdrawalLimit(a);
        btn.disabled = !canProceed;
        btn.classList.toggle('enabled', canProceed);
    }
}

function editWithdrawalAccount() {
    const a = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;
    if (!a) return showToast('Agent record not found.', 'danger');

    const method = _withdrawalMethod;
    let currentVal = '';
    let label = '';
    let placeholder = '';
    let nameLabel = '';
    let currentName = '';

    let fromProfileNote = '';
    if (method === 'upi') {
        label = 'UPI ID'; placeholder = 'yourname@bank'; currentVal = a.upiId || '';
        nameLabel = 'Name on UPI'; currentName = a.upiName || a.name || '';
    } else if (method === 'bank') {
        const kycBankAcc = a.kyc?.bankAcc || '';
        const kycHolder = a.kyc?.name || '';
        label = 'Bank Account No.'; placeholder = 'XXXX XXXX XXXX'; currentVal = a.bankAccount || kycBankAcc;
        nameLabel = 'Account Holder Name'; currentName = a.bankName || kycHolder || a.name || '';
        if (!a.bankAccount && kycBankAcc) {
            fromProfileNote = `<p style="font-size:12px;color:var(--text-muted);margin:0 0 4px;"><i class="fa-solid fa-circle-info"></i> Pre-filled from your Profile & KYC${a.kyc?.ifsc ? ` (IFSC ${escapeHTML(a.kyc.ifsc)})` : ''}. Editing here only changes it for withdrawals.</p>`;
        }
    }

    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.innerHTML = `
        <div class="modal-card" style="max-width:380px;">
            <div class="modal-header">
                <div class="modal-icon"><i class="fa-solid fa-wallet"></i></div>
                <h3>Edit ${label}</h3>
                <button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="modal-body" style="display:grid;gap:12px;">
                ${fromProfileNote}
                <div>
                    <label style="font-size:12px;font-weight:700;color:var(--text-muted);">${nameLabel}</label>
                    <input id="editAccName" class="glass-input" style="margin-top:6px;" value="${escapeHTML(currentName)}" placeholder="${escapeHTML(nameLabel)}" />
                </div>
                <div>
                    <label style="font-size:12px;font-weight:700;color:var(--text-muted);">${label}</label>
                    <input id="editAccVal" class="glass-input" style="margin-top:6px;" value="${escapeHTML(currentVal)}" placeholder="${placeholder}" />
                </div>
                <button class="btn-friendly-primary" id="saveAccBtn" style="margin-top:4px;">Save</button>
            </div>
        </div>`;
    document.body.appendChild(o);
    o.querySelector('.modal-close-btn').onclick = () => o.remove();
    o.onclick = e => { if (e.target === o) o.remove(); };
    o.querySelector('#saveAccBtn').onclick = () => {
        const newName = o.querySelector('#editAccName').value.trim();
        const newVal = o.querySelector('#editAccVal').value.trim();
        if (!newVal) return showToast('Please enter a value.', 'warning');
        if (method === 'upi') { a.upiId = newVal; a.upiName = newName; }
        else if (method === 'bank') { a.bankAccount = newVal; a.bankName = newName; }
        saveState();
        o.remove();
        selectWithdrawalMethod(method);
        showToast('Account details saved.', 'success');
    };
}

function submitWithdrawalRequest() {
    const xpVal = _withdrawalXP;
    const val = xpVal / 2; // 2 XP = ₹1 (hidden conversion)
    if (xpVal <= 0) return showToast('Select an XP amount to withdraw.', 'warning');
    const a = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;
    if (!a) return showToast('Agent record not found.', 'danger');

    if (hasReachedDailyWithdrawalLimit(a)) {
        return showToast('Daily withdrawal limit reached. Please try again tomorrow.', 'warning');
    }

    const methodLabel = { upi: 'UPI', bank: 'Bank Card' }[_withdrawalMethod] || 'UPI';
    const preview = getAgentRedeemPreview(a);
    if (val > preview.money) return showToast(`Max withdrawable is ${fmtINR(preview.money)}.`, 'warning');
    // Guard against the selected preset exceeding what's actually
    // redeemable in Balance XP right now (defense-in-depth alongside the
    // money check above, since presets are fixed steps).
    if (xpVal > preview.redeemableXP) return showToast(`Max withdrawable is ${preview.redeemableXP.toLocaleString('en-IN')} XP.`, 'warning');

    if (!confirm(`Request withdrawal of ₹${val.toFixed(2)} via ${methodLabel}?\n\nAdmin will be notified and will process payment.`)) return;

    // Block if there is already a pending redeem request
    if (a.xpRedeemRequest && a.xpRedeemRequest.status !== 'paid') {
        return showToast('You already have a pending withdrawal request.', 'warning');
    }

    // Deduct the withdrawn XP from Balance XP immediately (never from
    // a.xp — that's rank-progress XP, not the wallet).
    const balanceBefore = preview.xp;
    const balanceAfter = round2(balanceBefore - xpVal);
    a.balanceXP = balanceAfter;

    // Create the withdrawal request directly
    a.xpRedeemRequest = {
        id: genId('xpr'),
        requestedAt: Date.now(),
        payBefore: Date.now() + XP_COOLDOWN_HOURS * 60 * 60 * 1000,
        xpRedeemed: xpVal,
        money: val,
        method: _withdrawalMethod,
        xpBefore: balanceBefore,
        xpAfter: balanceAfter,
        status: 'pending'
    };
    a.lastWithdrawalDate = getTodayDateStr();

    state.xpRedeemRequests = state.xpRedeemRequests || [];
    state.xpRedeemRequests.unshift({
        id: a.xpRedeemRequest.id,
        agentId: a.id,
        agentName: a.name,
        requestedAt: a.xpRedeemRequest.requestedAt,
        payBefore: a.xpRedeemRequest.payBefore,
        xpRedeemed: xpVal,
        money: val,
        method: _withdrawalMethod,
        status: 'pending'
    });

    addAudit('Withdrawal requested', `${a.name} requested ₹${val.toFixed(2)} via ${methodLabel}`);
    addNotification(
        '💸 Withdrawal Request',
        `${a.name} requested a payout of ₹${val.toFixed(2)} via ${methodLabel}. Please process and mark as done.`,
        ['admin', 'developer'],
        '💸'
    );
    saveState();

    _withdrawalXP = 0;
    document.querySelectorAll('.withdrawal-preset-btn').forEach(b => b.classList.remove('active'));
    refreshWithdrawalAmount();

    renderXPWithdrawalRequestsPanel();
    updateXPWithdrawalBadge();
    if (typeof renderMyRankPage === 'function') renderMyRankPage();
    if (typeof renderAgentDashboardPanel === 'function') renderAgentDashboardPanel();
    if (typeof renderAgentWalletPage === 'function') renderAgentWalletPage();
    showToast(`Withdrawal request submitted! Admin will process ₹${val.toFixed(2)} within 48 hours.`, 'success');
}
