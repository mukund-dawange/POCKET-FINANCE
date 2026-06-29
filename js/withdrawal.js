// withdrawal.js
// XP Withdrawal module — extracted from ranking.js
// Depends on: state.js (state, agentState, saveState, addAudit, genId)
//             ui.js    (showToast, fmtINR)
//             ranking.js (getAgentRedeemPreview, XP_REDEEM_MINIMUM, XP_COOLDOWN_HOURS,
//                         addNotification, formatCountdown, renderMyRankPage)
//             wallet.js  (round2, escapeHTML)

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

    // Deduct XP immediately and create a pending request
    a.xp = preview.remainingXP;
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
            date: Date.now(),
            xpBefore: req.xpBefore || (req.xpRedeemed + (req.xpAfter || 0)),
            xpRedeemed: req.xpRedeemed,
            money: req.money,
            xpAfter: req.xpAfter || 0,
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
        badge.textContent = 'BANK';
        nameEl.textContent = (a && a.bankName) ? a.bankName : (a ? a.name : 'Your Name');
        subEl.textContent = (a && a.bankAccount) ? a.bankAccount : 'Set your bank account';
    } else if (method === 'usdt') {
        badge.textContent = 'USDT';
        nameEl.textContent = 'USDT Wallet';
        subEl.textContent = (a && a.usdtAddress) ? a.usdtAddress : 'Set your USDT address';
    }
}

function selectWithdrawalPreset(val) {
    // val is in ₹; display XP equivalent (val * 2) in the input
    document.querySelectorAll('.withdrawal-preset-btn').forEach(b => {
        b.classList.toggle('active', Number(b.dataset.preset) === val);
    });
    const inp = document.getElementById('withdrawalAmtInput');
    if (inp) { inp.value = val * 2; onWithdrawalAmtInput(); }
}

function onWithdrawalAmtInput() {
    document.querySelectorAll('.withdrawal-preset-btn').forEach(b => b.classList.remove('active'));
    // Input is XP; convert to ₹ silently (2 XP = ₹1)
    const xpVal = parseFloat(document.getElementById('withdrawalAmtInput')?.value) || 0;
    const rupeesVal = xpVal / 2;
    const recv = document.getElementById('withdrawalAmtReceived');
    const btn = document.getElementById('withdrawalSubmitBtn');
    if (recv) recv.textContent = '₹' + rupeesVal.toFixed(2);
    if (btn) {
        const canProceed = xpVal > 0;
        btn.disabled = !canProceed;
        btn.classList.toggle('enabled', canProceed);
    }
    // re-check preset highlight (preset data-preset stores ₹ value)
    const presetRupees = [500,1000,2000,3000,5000,10000,30000,50000].find(v => v === rupeesVal);
    if (presetRupees) {
        document.querySelectorAll('.withdrawal-preset-btn').forEach(b => {
            b.classList.toggle('active', Number(b.dataset.preset) === presetRupees);
        });
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

    if (method === 'upi') {
        label = 'UPI ID'; placeholder = 'yourname@bank'; currentVal = a.upiId || '';
        nameLabel = 'Name on UPI'; currentName = a.upiName || a.name || '';
    } else if (method === 'bank') {
        label = 'Bank Account No.'; placeholder = 'XXXX XXXX XXXX'; currentVal = a.bankAccount || '';
        nameLabel = 'Account Holder Name'; currentName = a.bankName || a.name || '';
    } else {
        label = 'USDT Address'; placeholder = 'T...'; currentVal = a.usdtAddress || '';
        nameLabel = 'Wallet Label'; currentName = a.usdtWalletLabel || 'My USDT Wallet';
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
        else { a.usdtAddress = newVal; a.usdtWalletLabel = newName; }
        saveState();
        o.remove();
        selectWithdrawalMethod(method);
        showToast('Account details saved.', 'success');
    };
}

function submitWithdrawalRequest() {
    const xpVal = parseFloat(document.getElementById('withdrawalAmtInput')?.value) || 0;
    const val = xpVal / 2; // 2 XP = ₹1 (hidden conversion)
    if (xpVal <= 0) return showToast('Enter a valid XP amount.', 'warning');
    const a = (state.user?.role === 'agent') ? agentState.find(x => x.id === state.user.agentId) : null;
    if (!a) return showToast('Agent record not found.', 'danger');

    const methodLabel = { upi: 'UPI', bank: 'Bank Card', usdt: 'USDT' }[_withdrawalMethod] || 'UPI';
    const preview = getAgentRedeemPreview(a);
    if (val > preview.money) return showToast(`Max withdrawable is ${fmtINR(preview.money)}.`, 'warning');

    if (!confirm(`Request withdrawal of ₹${val.toFixed(2)} via ${methodLabel}?\n\nAdmin will be notified and will process payment.`)) return;

    // Block if there is already a pending redeem request
    if (a.xpRedeemRequest && a.xpRedeemRequest.status !== 'paid') {
        return showToast('You already have a pending withdrawal request.', 'warning');
    }

    // Create the withdrawal request directly
    a.xpRedeemRequest = {
        id: genId('xpr'),
        requestedAt: Date.now(),
        payBefore: Date.now() + XP_COOLDOWN_HOURS * 60 * 60 * 1000,
        xpRedeemed: preview.redeemableXP,
        money: val,
        method: _withdrawalMethod,
        xpBefore: preview.xp,
        xpAfter: preview.xp,
        status: 'pending'
    };

    state.xpRedeemRequests = state.xpRedeemRequests || [];
    state.xpRedeemRequests.unshift({
        id: a.xpRedeemRequest.id,
        agentId: a.id,
        agentName: a.name,
        requestedAt: a.xpRedeemRequest.requestedAt,
        payBefore: a.xpRedeemRequest.payBefore,
        xpRedeemed: preview.redeemableXP,
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

    document.getElementById('withdrawalAmtInput') && (document.getElementById('withdrawalAmtInput').value = '');
    onWithdrawalAmtInput();

    renderXPWithdrawalRequestsPanel();
    updateXPWithdrawalBadge();
    if (typeof renderMyRankPage === 'function') renderMyRankPage();
    if (typeof renderAgentDashboardPanel === 'function') renderAgentDashboardPanel();
    if (typeof renderAgentWalletPage === 'function') renderAgentWalletPage();
    showToast(`Withdrawal request submitted! Admin will process ₹${val.toFixed(2)} within 48 hours.`, 'success');
}
