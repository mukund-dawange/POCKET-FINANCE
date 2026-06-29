/* ============================================================
   wallet.js — Business logic for every function in the sidebar
   ============================================================ */

function renderStatCards() {
    const total = state.wallet.cash + state.wallet.online;
    const activeLoanTotal = state.loans.filter(l => l.status === 'Active').reduce((s, l) => s + l.amount, 0);
    const isAgent = state.user?.role === 'agent';
    const scopedLoans = isAgent ? state.loans.filter(l => l.agentId === state.user.agentId) : state.loans;
    scopedLoans.forEach(normaliseLoan);
    const pendingTotal = scopedLoans.filter(l => l.status !== 'Paid').reduce((s, l) => s + (Number(l.outstanding) || 0), 0);
    const pendingInterestTotal = scopedLoans.filter(l => l.status !== 'Paid').reduce((s, l) => s + (Number(l.interestOutstanding) || 0), 0);

    document.getElementById('statTotalBalance').textContent = fmtINR(total);
    document.getElementById('statCashVault').textContent = fmtINR(state.wallet.cash);
    document.getElementById('statOnlineFunds').textContent = fmtINR(state.wallet.online);
    document.getElementById('statPendingDues').textContent = fmtINR(pendingTotal);
    document.getElementById('statPendingInterest').textContent = fmtINR(pendingInterestTotal);

    // Total collection across all agents (principal + interest collected back)
    const totalCollected = agentState.reduce((s, a) => s + (Number(a.collectionPool) || 0), 0);
    const el = document.getElementById('statCollectionIncome');
    if (el) el.textContent = fmtINR(totalCollected);

    if (isAgent) {
        const me = agentState.find(a => a.id === state.user.agentId);
        const activeAgentLoanTotal = scopedLoans.filter(l => l.status === 'Active').reduce((s, l) => s + l.amount, 0);
        document.getElementById('statAgentFund').textContent = fmtINR(me ? me.fund : 0);
        document.getElementById('statActiveLoans').textContent = fmtINR(activeAgentLoanTotal);
    } else {
        document.getElementById('statActiveLoans').textContent = fmtINR(activeLoanTotal);
    }
}

/* ---------------- WALLET OPERATIONS ---------------- */
function initWalletForms() {
    document.getElementById('depositForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const amt = parseFloat(document.getElementById('depositAmount').value);
        const target = document.getElementById('depositTarget').value;
        if (!amt || amt <= 0) return showToast('Enter a valid amount.', 'danger');

        state.wallet[target] += amt;
        addLog(`Deposit into ${target === 'cash' ? 'Cash' : 'Online'} Balance`, 'income', amt);
        autoAddToPersonalLedger(`Deposit into ${target === 'cash' ? 'Cash' : 'Online'} Balance`, 'income', amt);
        saveState();
        renderAll();
        showToast(`Deposited ${fmtINR(amt)} successfully.`, 'success');
        e.target.reset();
    });

    document.getElementById('withdrawForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const amt = parseFloat(document.getElementById('withdrawAmount').value);
        const source = document.getElementById('withdrawSource').value;
        if (!amt || amt <= 0) return showToast('Enter a valid amount.', 'danger');
        if (state.wallet[source] < amt) return showToast('Insufficient balance.', 'danger');

        state.wallet[source] -= amt;
        addLog(`Withdrawal from ${source === 'cash' ? 'Cash' : 'Online'} Balance`, 'expense', amt);
        autoAddToPersonalLedger(`Withdrawal from ${source === 'cash' ? 'Cash' : 'Online'} Balance`, 'expense', amt);
        saveState();
        renderAll();
        showToast(`Withdrew ${fmtINR(amt)} successfully.`, 'success');
        e.target.reset();
    });

    document.getElementById('transferForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const amt = parseFloat(document.getElementById('transferAmount').value);
        const dir = document.getElementById('transferDirection').value;
        if (!amt || amt <= 0) return showToast('Enter a valid amount.', 'danger');

        const from = dir === 'cash2online' ? 'cash' : 'online';
        const to = dir === 'cash2online' ? 'online' : 'cash';
        if (state.wallet[from] < amt) return showToast('Insufficient balance in source vault.', 'danger');

        state.wallet[from] -= amt;
        state.wallet[to] += amt;
        addLog(`Transfer ${from} → ${to}`, 'expense', 0);
        saveState();
        renderAll();
        showToast(`Transferred ${fmtINR(amt)} (${from} → ${to}).`, 'success');
        e.target.reset();
    });
}

/* ---------------- LOAN ACCOUNTS ---------------- */
function renderLoansTable() {
    const body = document.getElementById('loansTableBody');
    if (!state.loans.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row">No loans yet. Click "New Loan" to add one.</td></tr>';
        return;
    }
    body.innerHTML = state.loans.map(l => `
        <tr>
            <td>${escapeHTML(l.name)}</td>
            <td>${fmtINR(l.amount)}</td>
            <td><span class="status-pill ${l.status === 'Active' ? 'active' : 'paid'}">${l.status}</span></td>
            <td>${l.dueDate || '—'}</td>
            <td>
                ${l.status === 'Active' ? `<button class="row-action-btn" onclick="markLoanPaid('${l.id}')" title="Mark Paid"><i class="fa-solid fa-check"></i></button>` : ''}
                <button class="row-action-btn" onclick="deleteLoan('${l.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function initLoanActions() {
    document.getElementById('addLoanBtn').addEventListener('click', () => {
        showFormModal({
            title: 'New Loan',
            icon: 'fa-hand-holding-dollar',
            submitLabel: 'Create Loan',
            fields: [
                { id: 'name', label: 'Client Name', required: true, placeholder: 'e.g. Rahul Verma' },
                { id: 'amount', label: 'Loan Amount (₹)', type: 'number', required: true, min: 0, step: '0.01', placeholder: '0.00' },
                { id: 'dueDate', label: 'Due Date', type: 'date' }
            ],
            onSubmit: (v) => {
                const amount = parseFloat(v.amount);
                if (!v.name) return showToast('Client name is required.', 'danger');
                if (!amount || amount <= 0) return showToast('Invalid loan amount.', 'danger');

                state.loans.push({ id: genId('loan'), name: v.name, amount, status: 'Active', dueDate: v.dueDate || '', history: [] });
                addLog(`New loan issued to ${v.name}`, 'expense', amount);
                autoAddToPersonalLedger(`New loan issued to ${v.name}`, 'expense', amount);
                saveState();
                renderAll();
                showToast('Loan created.', 'success');
            }
        });
    });
}

function markLoanPaid(id) {
    const loan = state.loans.find(l => l.id === id);
    if (!loan) return;
    loan.status = 'Paid';
    addLog(`Loan repaid by ${loan.name}`, 'income', loan.amount);
    autoAddToPersonalLedger(`Loan repaid by ${loan.name}`, 'income', loan.amount);
    saveState();
    renderAll();
    showToast(`${loan.name}'s loan marked as paid.`, 'success');
}

function deleteLoan(id) {
    if (!confirm('Delete this loan record?')) return;
    state.loans = state.loans.filter(l => l.id !== id);
    saveState();
    renderAll();
    showToast('Loan deleted.', 'warning');
}

/* ---------------- MASTER LEDGER ---------------- */
function renderLedgerTable() {
    const body   = document.getElementById('ledgerTableBody');
    const thead  = document.querySelector('#page-ledger table thead tr');
    const role   = state.user?.role;
    const isAgent = role === 'agent';
    const myAgentId = state.user?.agentId || null;

    // Filter: agents see only their own entries (agentId matches or was set by them)
    // Admin/Dev see everything
    let logs = state.logs;
    if (isAgent) {
        logs = logs.filter(l => l.agentId === myAgentId);
    }

    // Add/remove "Agent" column for admin/dev
    if (thead) {
        const hasAgentCol = !!thead.querySelector('.ledger-agent-col');
        if (!isAgent && !hasAgentCol) {
            const th = document.createElement('th');
            th.className = 'ledger-agent-col';
            th.textContent = 'Agent';
            thead.insertBefore(th, thead.children[1]); // after Date
        } else if (isAgent && hasAgentCol) {
            thead.querySelector('.ledger-agent-col').remove();
        }
    }

    if (!logs.length) {
        const cols = isAgent ? 4 : 5;
        body.innerHTML = `<tr><td colspan="${cols}" class="empty-row">No transactions logged yet.</td></tr>`;
        return;
    }

    body.innerHTML = logs.slice(0, 100).map(log => {
        // Resolve agent name for admin/dev column
        let agentCell = '';
        if (!isAgent) {
            const agentName = log.agentId
                ? (agentState.find(a => a.id === log.agentId)?.name || 'Agent')
                : '<span style="color:var(--text-tertiary);font-size:11px">Admin / Direct</span>';
            agentCell = `<td data-label="Agent">${typeof agentName === 'string' && agentName.startsWith('<') ? agentName : escapeHTML(agentName)}</td>`;
        }
        return `
        <tr>
            <td data-label="Date">${new Date(log.timestampMs).toLocaleString('en-IN')}</td>
            ${agentCell}
            <td data-label="Description">${escapeHTML(log.description)}</td>
            <td data-label="Type"><span class="status-pill ${log.typeClass === 'income' ? 'paid' : 'active'}">${log.typeClass}</span></td>
            <td data-label="Impact">${log.impactStr}</td>
        </tr>`;
    }).join('');
}

function initLedgerActions() {
    document.getElementById('exportLedgerBtn')?.addEventListener('click', () => {
        const role = state.user?.role;
        const isAgent = role === 'agent';
        let logs = state.logs;
        if (isAgent) logs = logs.filter(l => l.agentId === state.user?.agentId);
        if (!logs.length) return showToast('No data to export.', 'warning');
        const header = isAgent ? 'Date,Description,Type,Impact\n' : 'Date,Agent,Description,Type,Impact\n';
        const rows = logs.map(l => {
            const agentName = !isAgent ? (l.agentId ? (agentState.find(a => a.id === l.agentId)?.name || 'Agent') : 'Admin/Direct') : null;
            const base = `"${new Date(l.timestampMs).toLocaleString('en-IN')}","${l.description}","${l.typeClass}","${l.impactStr}"`;
            return isAgent ? base : `"${new Date(l.timestampMs).toLocaleString('en-IN')}","${agentName}","${l.description}","${l.typeClass}","${l.impactStr}"`;
        }).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'pocket_finance_ledger.csv'; a.click();
        URL.revokeObjectURL(url);
        showToast('Ledger exported.', 'success');
    });
}

/* ============================================================
   AUTO PERSONAL LEDGER — helper
   Called automatically whenever admin/dev performs any income
   or expense action (deposit, withdrawal, loan issued/repaid,
   fund given to agent, payment received, etc.).
   Skips entries where amount is 0 (e.g. internal transfers).
   Admin never needs to make a manual entry for these events.
   ============================================================ */

function autoAddToPersonalLedger(description, type, amount, note = '') {
    // Only auto-log for admin / developer roles
    const role = state.user?.role;
    if (!['admin', 'developer'].includes(role)) return;
    // Skip zero-amount actions (e.g. internal cash↔online transfers, pending interest markers)
    if (!amount || amount <= 0) return;

    state.adminLogs = state.adminLogs || [];
    state.adminLogs.unshift({
        id: genId('alog'),
        date: new Date().toISOString().slice(0, 10),
        description: description,
        type: type,           // 'income' | 'expense'
        amount: amount,
        note: note || '🤖 Auto-recorded'
    });
    // No separate saveState() here — the caller already does it
}

/* ============================================================
   ADMIN PERSONAL LEDGER
   A private income/expense notebook for the admin.
   Stored in state.adminLogs — separate from the shared master
   ledger so it never appears to agents.
   ============================================================ */

function renderAdminLedgerPage() {
    const role = state.user?.role;
    if (!['admin', 'developer'].includes(role)) return;

    const logs = (state.adminLogs || []);

    // Running balance
    let balance = 0;
    logs.forEach(l => { balance += l.type === 'income' ? Number(l.amount) : -Number(l.amount); });
    const balEl = document.getElementById('adminLedgerBalance');
    if (balEl) {
        balEl.textContent = (balance >= 0 ? '+' : '') + '\u20b9' + Math.abs(balance).toLocaleString('en-IN');
        balEl.style.color = balance >= 0 ? 'var(--success, #1d9e75)' : 'var(--danger, #e24b4a)';
    }

    // Summary counts
    const incTotal = logs.filter(l => l.type === 'income').reduce((s, l) => s + Number(l.amount), 0);
    const expTotal = logs.filter(l => l.type === 'expense').reduce((s, l) => s + Number(l.amount), 0);
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('adminLedgerIncTotal', '\u20b9' + incTotal.toLocaleString('en-IN'));
    setEl('adminLedgerExpTotal', '\u20b9' + expTotal.toLocaleString('en-IN'));
    setEl('adminLedgerCount', logs.length);

    const body = document.getElementById('adminLedgerTableBody');
    if (!body) return;
    if (!logs.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row">No personal records yet. Add your first entry above.</td></tr>';
        return;
    }
    body.innerHTML = logs.slice(0, 200).map(l => `
        <tr>
            <td data-label="Date">${escapeHTML(l.date)}</td>
            <td data-label="Description">
                <div style="font-weight:600">${escapeHTML(l.description)}</div>
                ${l.note ? `<div style="font-size:11.5px;color:${l.note === '🤖 Auto-recorded' ? 'var(--primary,#6c63ff)' : 'var(--text-tertiary)'}">` + escapeHTML(l.note) + '</div>' : ''}
            </td>
            <td data-label="Type"><span class="status-pill ${l.type === 'income' ? 'paid' : 'active'}">${l.type}</span></td>
            <td data-label="Amount" style="font-weight:700;color:${l.type === 'income' ? 'var(--success,#1d9e75)' : 'var(--danger,#e24b4a)'}">
                ${l.type === 'income' ? '+' : '-'}\u20b9${Number(l.amount).toLocaleString('en-IN')}
            </td>
            <td data-label="Remove" style="text-align:center">
                <button class="row-action-btn" data-admin-log-del="${l.id}" title="Delete entry" style="color:var(--danger,#e24b4a)">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>`).join('');

    body.querySelectorAll('[data-admin-log-del]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this personal record?')) return;
            state.adminLogs = (state.adminLogs || []).filter(l => l.id !== btn.dataset.adminLogDel);
            saveState();
            renderAdminLedgerPage();
            showToast('Record deleted.', 'warning');
        });
    });
}

function initAdminLedgerActions() {
    const addBtn = document.getElementById('adminLedgerAddBtn');
    const expBtn = document.getElementById('adminLedgerExportBtn');
    if (!addBtn) return;
    // Pre-fill date with today
    const dateInput = document.getElementById('adminLedgerDate');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    addBtn.addEventListener('click', () => {
        const desc  = document.getElementById('adminLedgerDesc')?.value.trim();
        const type  = document.getElementById('adminLedgerType')?.value;
        const amt   = parseFloat(document.getElementById('adminLedgerAmt')?.value);
        const date  = document.getElementById('adminLedgerDate')?.value;
        const note  = document.getElementById('adminLedgerNote')?.value.trim();

        if (!desc)           return showToast('Please enter a description.', 'danger');
        if (!amt || amt <= 0) return showToast('Please enter a valid amount.', 'danger');
        if (!date)           return showToast('Please select a date.', 'danger');

        state.adminLogs = state.adminLogs || [];
        state.adminLogs.unshift({
            id: genId('alog'),
            date, description: desc, type, amount: amt, note: note || ''
        });
        // Clear form
        document.getElementById('adminLedgerDesc').value = '';
        document.getElementById('adminLedgerAmt').value  = '';
        document.getElementById('adminLedgerNote').value = '';
        document.getElementById('adminLedgerDate').value = new Date().toISOString().slice(0,10);

        addAudit('Admin personal ledger', `${type} entry: ${desc}`);
        saveState();
        renderAdminLedgerPage();
        showToast('Record added.', 'success');
    });

    expBtn?.addEventListener('click', () => {
        const logs = state.adminLogs || [];
        if (!logs.length) return showToast('No records to export.', 'warning');
        const header = 'Date,Description,Type,Amount,Note\n';
        const rows = logs.map(l =>
            `"${l.date}","${l.description}","${l.type}","${l.amount}","${l.note || ''}"`
        ).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'admin_personal_ledger.csv'; a.click();
        URL.revokeObjectURL(url);
        showToast('Exported.', 'success');
    });
}

/* ---------------- CLIENTS ---------------- */
/* Client Directory has been removed — agents give money to clients via
   Loan Accounts directly, and admin/dev track pending dues per agent
   through the Loan Accounts agent filter + Dashboard analytics instead. */

/* ---------------- TICKETS (formerly SOS) ----------------
   Rendering and actions now live in agent-portal.js
   (renderTicketsPage / initTicketsPage), which understands the
   richer ticket shape and handles both agent + admin views.
   These two are kept as thin pass-throughs so the existing
   renderAll()/app.js call sites don't need to change. */
function renderSosTable() {
    if (typeof renderTicketsPage === 'function') renderTicketsPage();
}

function initSosActions() {
    // wiring now happens in initTicketsPage(), called from initAgentPortal()
}

/* ---------------- ADMIN PANEL ---------------- */
function initAdminActions() {
    document.getElementById('addAgentBtn').addEventListener('click', showAddAgentModal);

    document.getElementById('connectDbBtn').addEventListener('click', () => {
        const url = document.getElementById('sharedDbUrl').value.trim();
        if (!url) return showToast('Paste a valid Apps Script URL first.', 'danger');
        localStorage.setItem('pf_sharedDbUrl', url);
        showToast('Shared DB URL saved. Wire it up in wallet.js to go live.', 'info');
    });

    const savedUrl = localStorage.getItem('pf_sharedDbUrl');
    if (savedUrl) document.getElementById('sharedDbUrl').value = savedUrl;
}

function showAddAgentModal() {
    showFormModal({
        title: 'Add Agent',
        icon: 'fa-users-gear',
        submitLabel: 'Create Agent',
        wide: true,
        intro: 'The agent will log in with this ID & password. Initial funds are deducted from the vault you choose.',
        fields: [
            { id: 'name', label: 'Agent Name', required: true, placeholder: 'e.g. Priya Singh' },
            { id: 'username', label: 'Login ID', required: true, placeholder: 'e.g. priya.agent' },
            { id: 'password', label: 'Password', type: 'password', required: true, placeholder: 'Minimum 6 characters' },
            { id: 'fund', label: 'Initial Fund Allocation (₹)', type: 'number', required: true, min: 0, step: '0.01', placeholder: '0.00' },
            { id: 'source', label: 'Give From', type: 'select', options: [{ value: 'cash', label: 'Cash Vault' }, { value: 'online', label: 'Online Funds' }] }
        ],
        onSubmit: (v) => {
            const fund = parseFloat(v.fund) || 0;
            if (!v.name) return showToast('Agent name is required.', 'danger');
            if (!v.username) return showToast('Login ID is required.', 'danger');
            if (!v.password || v.password.length < 6) return showToast('Password must be at least 6 characters.', 'danger');
            if (agentState.some(a => a.username.toLowerCase() === v.username.toLowerCase())) return showToast('That Login ID is already in use by another agent.', 'danger');
            if (fund > 0 && state.wallet[v.source] < fund) return showToast(`Insufficient balance in ${v.source === 'cash' ? 'Cash Vault' : 'Online Funds'}.`, 'danger');

            if (fund > 0) {
                state.wallet[v.source] -= fund;
                addLog(`Fund allocated to new agent ${v.name}`, 'expense', fund);
                autoAddToPersonalLedger(`Fund allocated to new agent ${v.name}`, 'expense', fund);
            }
            // Auto-assign Level 1 (No Rank) and set allocatedAmount = fund
            const firstLevel = typeof sortedLevelDefs === 'function' ? sortedLevelDefs()[0] : null;
            agentState.push({ id: genId('agent'), name: v.name, username: v.username, password: v.password, fund, createdAt: Date.now(), levelId: firstLevel?.id || '', allocatedAmount: fund, xp: 0 });
            addAudit('Agent created', `Agent "${v.name}" (${v.username}) created with ${fmtINR(fund)} from ${v.source}`);
            saveState();
            renderAll();
            showToast(`Agent "${v.name}" created with ${fmtINR(fund)} allocated.`, 'success');
        }
    });
}

function renderAgentManager() {
    const root = document.getElementById('agentManagerList');
    if (!root) return;
    if (!agentState.length) {
        root.innerHTML = '<p class="empty-row">No agents yet. Click "Add New Agent" to create one.</p>';
        return;
    }
    const kycBadge = (a) => {
        if (typeof kycEnsureShape === 'function') kycEnsureShape(a);
        const status = a.kyc?.status || 'not_submitted';
        const map = {
            approved: ['#16a34a', 'KYC Approved'],
            pending: ['#d97706', 'KYC Pending Review'],
            rejected: ['#dc2626', 'KYC Rejected'],
            not_submitted: ['#94a3b8', 'KYC Not Submitted']
        };
        const [color, label] = map[status];
        return `<small style="display:block;margin-top:4px;color:${color};font-weight:600;">● ${label}</small>`;
    };
    root.innerHTML = agentState.map(a => `
        <div class="agent-card">
            <h4>${escapeHTML(a.name)}</h4>
            <small>Login ID: ${escapeHTML(a.username)}${a.disabled ? ' · <span style="color:#ef4444;">Disabled</span>' : ''}</small>
            ${kycBadge(a)}
            <div class="agent-fund-amt">${fmtINR(a.fund)}</div>
            <div class="agent-card-actions">
                <button class="btn-friendly-primary compact" data-give="${a.id}"><i class="fa-solid fa-money-bill-transfer"></i> Give Fund</button>
                <button class="btn-friendly-secondary compact" data-allocate="${a.id}"><i class="fa-solid fa-bullseye"></i> Allocation</button>
                <button class="btn-friendly-secondary compact" data-edit="${a.id}"><i class="fa-solid fa-key"></i> Edit Login</button>
                <button class="btn-friendly-secondary compact" data-toggle="${a.id}"><i class="fa-solid fa-power-off"></i> ${a.disabled ? 'Enable' : 'Disable'}</button>
                <button class="row-action-btn" data-delete="${a.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
            ${typeof getAgentCurrentLevel === 'function' ? `<small style="display:block;margin-top:10px;color:var(--text-muted);">${escapeHTML(getAgentCurrentLevel(a)?.rankName || 'Unranked')} · ${getAgentProgressPct(a)}% progress</small>` : ''}
        </div>
    `).join('');
    root.querySelectorAll('[data-give]').forEach(b => b.onclick = () => giveAgentFund(b.dataset.give));
    root.querySelectorAll('[data-allocate]').forEach(b => b.onclick = () => showSetAllocationModal(b.dataset.allocate));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editAgentLogin(b.dataset.edit));
    root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleAgent(b.dataset.toggle));
    root.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteAgent(b.dataset.delete));
}

function giveAgentFund(id) {
    const a = agentState.find(x => x.id === id);
    if (!a) return;
    if (typeof kycEnsureShape === 'function') kycEnsureShape(a);
    const kycStatus = a.kyc?.status || 'not_submitted';
    const kycWarning = kycStatus !== 'approved'
        ? ` ⚠️ This agent's KYC is ${kycStatus === 'pending' ? 'still pending review' : kycStatus === 'rejected' ? 'rejected' : 'not submitted yet'} — you can still allocate funds, but consider reviewing their KYC Approvals entry first.`
        : '';
    showFormModal({
        title: `Give Fund — ${a.name}`,
        icon: 'fa-money-bill-transfer',
        submitLabel: 'Give Fund',
        intro: `Current fund: ${fmtINR(a.fund)}. Choose which vault this comes from.${kycWarning}`,
        fields: [
            { id: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0.01, step: '0.01', placeholder: '0.00' },
            { id: 'source', label: 'Give From', type: 'select', options: [{ value: 'cash', label: `Cash Vault (${fmtINR(state.wallet.cash)})` }, { value: 'online', label: `Online Funds (${fmtINR(state.wallet.online)})` }] }
        ],
        onSubmit: (v) => {
            const amt = parseFloat(v.amount);
            if (!amt || amt <= 0) return showToast('Enter a valid amount.', 'danger');
            if (state.wallet[v.source] < amt) return showToast('Insufficient balance in selected vault.', 'danger');
            state.wallet[v.source] -= amt;
            a.fund += amt;
            addLog(`Fund given to agent ${a.name}`, 'expense', amt);
            autoAddToPersonalLedger(`Fund given to agent ${a.name}`, 'expense', amt);
            addAudit('Agent fund given', `${fmtINR(amt)} given to agent "${a.name}" from ${v.source}`);
            saveState();
            renderAll();
            showToast(`${fmtINR(amt)} given to ${a.name}.`, 'success');
        }
    });
}

function editAgentLogin(id) {
    const a = agentState.find(x => x.id === id);
    if (!a) return;
    showFormModal({
        title: `Edit ${a.name}`,
        icon: 'fa-pen',
        submitLabel: 'Save Changes',
        fields: [
            { id: 'name', label: 'Agent Name', required: true, value: a.name },
            { id: 'username', label: 'Login ID', required: true, value: a.username },
            { id: 'password', label: 'New Password', type: 'password', placeholder: 'Leave blank to keep current' }
        ],
        onSubmit: (v) => {
            if (!v.name || !v.username) return showToast('Name and Login ID are required.', 'danger');
            if (agentState.some(x => x.id !== id && x.username.toLowerCase() === v.username.toLowerCase())) return showToast('That Login ID is already in use.', 'danger');
            if (v.password && v.password.length < 6) return showToast('Password must be at least 6 characters.', 'danger');
            a.name = v.name;
            a.username = v.username;
            if (v.password) a.password = v.password;
            addAudit('Agent updated', `Agent "${a.name}" login updated by admin`);
            saveState();
            renderAll();
            showToast('Agent updated.', 'success');
        }
    });
}

function toggleAgent(id) {
    const a = agentState.find(x => x.id === id);
    if (!a) return;
    a.disabled = !a.disabled;
    addAudit('Agent status changed', `Agent "${a.name}" ${a.disabled ? 'disabled' : 'enabled'}`);
    saveState();
    renderAll();
    showToast(`${a.name} ${a.disabled ? 'disabled' : 'enabled'}.`, a.disabled ? 'warning' : 'success');
}

function deleteAgent(id) {
    const a = agentState.find(x => x.id === id);
    if (!a) return;
    if (!confirm(`Delete agent "${a.name}"? Their remaining fund (${fmtINR(a.fund)}) will be returned to the Cash Vault.`)) return;
    state.wallet.cash += a.fund;
    agentState = agentState.filter(x => x.id !== id);
    addAudit('Agent deleted', `Agent "${a.name}" deleted; ${fmtINR(a.fund)} returned to Cash Vault`);
    saveState();
    renderAll();
    showToast('Agent deleted.', 'warning');
}

/* ---------------- DEV CONSOLE ---------------- */
function renderDevConsole() {
    const out = document.getElementById('devStateOutput');
    if (!out) return;
    out.textContent = JSON.stringify({ state, agentState }, null, 2);
}

/* Populate the agent-wipe dropdown with current agents */
function devWipePopulateAgents() {
    const sel = document.getElementById('devWipeAgentSelect');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Choose an agent —</option>' +
        agentState.map(a => `<option value="${a.id}">${escapeHTML(a.name)} (${escapeHTML(a.username || '')})</option>`).join('');
    if (agentState.some(a => a.id === current)) sel.value = current;
    // Hide preview whenever agents reload
    document.getElementById('devWipePreviewCard').style.display = 'none';
    document.getElementById('devWipeDeleteRow').style.display = 'none';
}

/* Show a summary of the selected agent's data without deleting */
function devWipePreviewAgent() {
    const agentId = document.getElementById('devWipeAgentSelect').value;
    const agent = agentState.find(a => a.id === agentId);
    if (!agent) return showToast('Please choose an agent first.', 'danger');

    const loans   = state.loans.filter(l => l.agentId === agentId).length;
    const tickets = state.sos.filter(t => t.agentId === agentId).length;
    const marks   = (state.agentMarks || []).filter(m => m.agentId === agentId).length;
    const fund    = Number(agent.fund) || 0;

    document.getElementById('devWipeAgentNameLabel').textContent = agent.name;
    document.getElementById('devWipeLoanCount').textContent    = loans;
    document.getElementById('devWipeTicketCount').textContent  = tickets;
    document.getElementById('devWipeMarkCount').textContent    = marks;
    document.getElementById('devWipeFundLabel').textContent    = fmtINR(fund);

    document.getElementById('devWipePreviewCard').style.display = '';
    document.getElementById('devWipeDeleteRow').style.display   = '';
}

/* Delete all data tied to the selected agent, keep the account */
function devWipeAgentData() {
    if (state.user?.role !== 'developer') return showToast('Developer access required.', 'danger');

    const agentId = document.getElementById('devWipeAgentSelect').value;
    const agent   = agentState.find(a => a.id === agentId);
    if (!agent) return showToast('Please choose an agent first.', 'danger');

    const loanCount   = state.loans.filter(l => l.agentId === agentId).length;
    const ticketCount = state.sos.filter(t => t.agentId === agentId).length;
    const markCount   = (state.agentMarks || []).filter(m => m.agentId === agentId).length;

    showFormModal({
        title: `Wipe Data — ${agent.name}`,
        icon: 'fa-user-xmark',
        submitLabel: 'Yes, Delete This Agent\'s Data',
        intro: `This will permanently delete:\n• ${loanCount} loan record${loanCount !== 1 ? 's' : ''}\n• ${ticketCount} support ticket${ticketCount !== 1 ? 's' : ''}\n• ${markCount} schedule mark${markCount !== 1 ? 's' : ''}\n• Fund balance reset to ₹0\n\nThe agent account will NOT be deleted. Type the agent's name to confirm.`,
        fields: [{ id: 'confirm', label: 'Type agent name to confirm', required: true, placeholder: agent.name }],
        onSubmit: (v) => {
            if (v.confirm.trim().toLowerCase() !== agent.name.trim().toLowerCase()) {
                return showToast('Name did not match — deletion cancelled.', 'danger');
            }

            // Remove loans
            state.loans = state.loans.filter(l => l.agentId !== agentId);

            // Remove from trash too
            if (state.loanTrash) state.loanTrash = state.loanTrash.filter(l => l.agentId !== agentId);

            // Remove tickets
            state.sos = state.sos.filter(t => t.agentId !== agentId);

            // Remove schedule marks
            state.agentMarks = (state.agentMarks || []).filter(m => m.agentId !== agentId);

            // Reset agent financial fields — keep id, name, username, password, levelId, rank info
            agent.fund              = 0;
            agent.allocatedAmount   = 0;
            agent.collectionPool    = 0;
            agent.incomeEarned      = 0;
            agent.xp                = 0;
            agent.incomeHistory     = [];
            agent.redeemHistory     = [];
            agent.upgradeRequest    = null;

            addAudit('Agent data wiped', `Developer wiped all data for agent "${agent.name}" (${agentId})`);
            saveState();
            renderAll();

            // Reset the preview panel
            document.getElementById('devWipePreviewCard').style.display = 'none';
            document.getElementById('devWipeDeleteRow').style.display   = 'none';
            document.getElementById('devWipeAgentSelect').value         = '';

            showToast(`All data for "${agent.name}" has been deleted. Account kept.`, 'warning');
        }
    });
}

/* ============================================================
   SELECTIVE DATA DELETE — Dev Console
   Lets the developer pick an agent, browse their individual
   loans / tickets / schedule marks as a checklist, and delete
   only the ticked items. Completely separate from the bulk wipe.
   ============================================================ */

let _devSelTab      = 'loans';   // active tab: 'loans' | 'tickets' | 'marks'
let _devSelAgentId  = null;      // agent currently loaded in the browser
let _devSelChecked  = new Set(); // IDs of ticked records

/* Populate the agent dropdown in the Selective Delete panel */
function devSelPopulateAgents() {
    const sel = document.getElementById('devSelAgentSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Choose an agent —</option>' +
        agentState.map(a =>
            `<option value="${a.id}">${escapeHTML(a.name)} (${escapeHTML(a.username || '')})</option>`
        ).join('');
    if (agentState.some(a => a.id === prev)) sel.value = prev;
}

/* Load records for chosen agent and open the browser */
function devSelLoadRecords() {
    const agentId = document.getElementById('devSelAgentSelect').value;
    if (!agentId) return showToast('Please choose an agent first.', 'danger');
    _devSelAgentId = agentId;
    _devSelChecked.clear();
    _devSelTab = 'loans';
    devSelHighlightTab('loans');
    document.getElementById('devSelBrowser').style.display = '';
    devSelRenderList();
}

/* Switch active tab */
function devSelHighlightTab(tab) {
    _devSelTab = tab;
    _devSelChecked.clear();           // clear selection on tab switch
    ['loans','tickets','marks'].forEach(t => {
        const btn = document.getElementById(`devSelTab${t.charAt(0).toUpperCase()+t.slice(1)}`);
        if (btn) btn.className = `filter-chip${t === tab ? ' fc-active-all' : ''}`;
    });
    devSelRenderList();
}

/* Build the record rows for the current tab */
function devSelRenderList() {
    const list   = document.getElementById('devSelRecordList');
    const cntLbl = document.getElementById('devSelCountLabel');
    const delBtn = document.getElementById('devSelDeleteBtn');
    if (!list || !_devSelAgentId) return;

    const records = devSelGetRecords();
    devSelUpdateBadges();

    if (!records.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:28px 0">
            <div style="font-size:28px;margin-bottom:8px">📭</div>No ${_devSelTab} found for this agent.</div>`;
        devSelSyncToolbar();
        return;
    }

    list.innerHTML = records.map(r => {
        const checked = _devSelChecked.has(r.id);
        return `<label class="dev-sel-row${checked ? ' dev-sel-row-checked' : ''}" data-dev-sel-id="${r.id}"
                    style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:var(--radius-md);
                           border:1px solid ${checked ? 'var(--danger,#e24b4a)' : 'var(--border)'};
                           background:${checked ? 'color-mix(in srgb,var(--danger,#e24b4a) 8%,transparent)' : 'var(--bg-secondary)'};
                           cursor:pointer;transition:border-color .15s,background .15s">
                  <input type="checkbox" class="dev-sel-chk" data-dev-sel-id="${r.id}"
                         style="margin-top:2px;accent-color:var(--danger,#e24b4a);flex-shrink:0"
                         ${checked ? 'checked' : ''}>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.primary}</div>
                    <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px">${r.secondary}</div>
                  </div>
                  <span style="font-size:11px;font-weight:600;white-space:nowrap;padding:3px 8px;border-radius:999px;
                               background:var(--bg-tertiary,#f3f4f6);color:var(--text-secondary)">${r.badge}</span>
                </label>`;
    }).join('');

    // Checkbox toggle
    list.querySelectorAll('.dev-sel-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            const id = chk.dataset.devSelId;
            if (chk.checked) _devSelChecked.add(id); else _devSelChecked.delete(id);
            devSelRenderList();          // re-render to update row highlight
        });
    });

    devSelSyncToolbar();
}

/* Returns an array of { id, primary, secondary, badge } for current tab */
function devSelGetRecords() {
    if (!_devSelAgentId) return [];
    if (_devSelTab === 'loans') {
        return state.loans
            .filter(l => l.agentId === _devSelAgentId)
            .map(l => ({
                id:        l.id,
                primary:   `${l.name || 'Unnamed'} — ${fmtINR(l.amount)}`,
                secondary: `Due: ${l.dueDate || '—'} · Issued: ${l.sanctionDate ? l.sanctionDate.slice(0,10) : '—'}`,
                badge:     l.status || 'Active'
            }));
    }
    if (_devSelTab === 'tickets') {
        return state.sos
            .filter(t => t.agentId === _devSelAgentId)
            .map(t => ({
                id:        t.id,
                primary:   t.title || t.reason || 'Untitled',
                secondary: `Raised: ${t.raisedOn ? new Date(t.raisedOn).toLocaleDateString('en-IN') : '—'} · ${t.category || 'other'}`,
                badge:     t.status || 'Open'
            }));
    }
    if (_devSelTab === 'marks') {
        return (state.agentMarks || [])
            .filter(m => m.agentId === _devSelAgentId)
            .map(m => ({
                id:        m.id,
                primary:   m.label || 'Unnamed mark',
                secondary: `Date: ${m.date || '—'}${m.note ? ' · ' + m.note : ''}`,
                badge:     m.date || '—'
            }));
    }
    return [];
}

/* Update tab count badges */
function devSelUpdateBadges() {
    if (!_devSelAgentId) return;
    const lc = state.loans.filter(l => l.agentId === _devSelAgentId).length;
    const tc = state.sos.filter(t => t.agentId === _devSelAgentId).length;
    const mc = (state.agentMarks || []).filter(m => m.agentId === _devSelAgentId).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('devSelLoansBadge',   lc);
    set('devSelTicketsBadge', tc);
    set('devSelMarksBadge',   mc);
}

/* Sync toolbar: count label + Delete button visibility */
function devSelSyncToolbar() {
    const n      = _devSelChecked.size;
    const cntLbl = document.getElementById('devSelCountLabel');
    const delBtn = document.getElementById('devSelDeleteBtn');
    if (cntLbl) cntLbl.textContent = n > 0 ? `${n} item${n !== 1 ? 's' : ''} selected` : '0 selected';
    if (delBtn) delBtn.style.display = n > 0 ? '' : 'none';
}

/* Select all / deselect all for current tab */
function devSelSelectAll() {
    devSelGetRecords().forEach(r => _devSelChecked.add(r.id));
    devSelRenderList();
}
function devSelDeselectAll() {
    _devSelChecked.clear();
    devSelRenderList();
}

/* Confirm and delete only the ticked records */
function devSelDeleteSelected() {
    if (state.user?.role !== 'developer') return showToast('Developer access required.', 'danger');
    const n = _devSelChecked.size;
    if (!n) return showToast('No items selected.', 'danger');

    const agent = agentState.find(a => a.id === _devSelAgentId);
    const tabLabel = { loans: 'loan', tickets: 'ticket', marks: 'schedule mark' }[_devSelTab];

    if (!confirm(`Permanently delete ${n} selected ${tabLabel}${n !== 1 ? 's' : ''} for "${agent?.name || 'agent'}"?\n\nThis cannot be undone.`)) return;

    const ids = new Set(_devSelChecked);

    if (_devSelTab === 'loans') {
        const removed = state.loans.filter(l => ids.has(l.id));
        state.loans = state.loans.filter(l => !ids.has(l.id));
        if (state.loanTrash) state.loanTrash = state.loanTrash.filter(l => !ids.has(l.id));
        addAudit('Selective data delete', `Developer deleted ${removed.length} loan(s) for agent "${agent?.name}"`);
    } else if (_devSelTab === 'tickets') {
        const removed = state.sos.filter(t => ids.has(t.id));
        state.sos = state.sos.filter(t => !ids.has(t.id));
        addAudit('Selective data delete', `Developer deleted ${removed.length} ticket(s) for agent "${agent?.name}"`);
    } else if (_devSelTab === 'marks') {
        const removed = (state.agentMarks || []).filter(m => ids.has(m.id));
        state.agentMarks = (state.agentMarks || []).filter(m => !ids.has(m.id));
        addAudit('Selective data delete', `Developer deleted ${removed.length} schedule mark(s) for agent "${agent?.name}"`);
    }

    _devSelChecked.clear();
    saveState();
    renderAll();                // refreshes loans table, sos table, etc.
    devSelRenderList();         // refresh the checklist panel
    showToast(`${n} ${tabLabel}${n !== 1 ? 's' : ''} deleted.`, 'warning');
}

/* Called by renderAll() to keep the panel in sync after any state change */
function devSelRefreshIfOpen() {
    if (document.getElementById('devSelBrowser')?.style.display === 'none') return;
    devSelUpdateBadges();
    devSelRenderList();
}

function initDevConsoleActions() {
    document.getElementById('refreshStateBtn').addEventListener('click', renderDevConsole);

    // Agent wipe panel
    devWipePopulateAgents();
    document.getElementById('devWipeAgentSelect')?.addEventListener('change', () => {
        // Hide stale preview when agent selection changes
        document.getElementById('devWipePreviewCard').style.display = 'none';
        document.getElementById('devWipeDeleteRow').style.display   = 'none';
    });
    document.getElementById('devWipePreviewBtn')?.addEventListener('click', devWipePreviewAgent);
    document.getElementById('devWipeAgentDataBtn')?.addEventListener('click', devWipeAgentData);

    // Selective Data Delete panel
    devSelPopulateAgents();
    document.getElementById('devSelLoadBtn')?.addEventListener('click', devSelLoadRecords);
    document.getElementById('devSelAgentSelect')?.addEventListener('change', () => {
        // Reset browser when a different agent is picked
        _devSelAgentId = null;
        _devSelChecked.clear();
        document.getElementById('devSelBrowser').style.display = 'none';
    });
    // Tab buttons
    document.querySelectorAll('[data-dev-sel-tab]').forEach(btn => {
        btn.addEventListener('click', () => devSelHighlightTab(btn.dataset.devSelTab));
    });
    document.getElementById('devSelSelectAll')?.addEventListener('click', devSelSelectAll);
    document.getElementById('devSelDeselectAll')?.addEventListener('click', devSelDeselectAll);
    document.getElementById('devSelDeleteBtn')?.addEventListener('click', devSelDeleteSelected);
    document.getElementById('saveGoogleClientBtn').addEventListener('click',()=>{
        if(state.user?.role!=='developer') return;
        const id=document.getElementById('googleClientId').value.trim();
        localStorage.setItem('pf_googleClientId',id);addAudit('Security setting','Google Client ID updated');showToast('Google login configuration saved.','success');
    });
    document.getElementById('clearAuditBtn').addEventListener('click',()=>{
        if(state.user?.role!=='developer'||!confirm('Clear the complete activity history?'))return;
        localStorage.removeItem(AUDIT_KEY);addAudit('Audit cleared','Developer cleared activity history');renderAuditLog();
    });
    document.getElementById('dangerResetBtn').addEventListener('click', () => {
        if (state.user?.role !== 'developer') return showToast('Developer access required.', 'danger');
        showFormModal({
            title: 'Confirm Permanent Reset',
            icon: 'fa-triangle-exclamation',
            submitLabel: 'Permanently Reset Data',
            intro: 'This cannot be undone. Type RESET below to confirm.',
            fields: [{ id: 'confirmation', label: 'Confirmation', required: true, placeholder: 'Type RESET' }],
            onSubmit: (v) => {
                if (v.confirmation !== 'RESET') return showToast('Reset cancelled: confirmation did not match.', 'danger');
                resetState();
                renderAll();
                switchSection('dashboard');
                showToast('All application data has been reset.', 'warning');
            }
        });
    });
}

async function renderAccessManager(){
    const root=document.getElementById('accessAccounts');if(!root)return;
    root.innerHTML='<p class="empty-row">Loading logins…</p>';
    const res=await apiListAccounts();
    if(!res.success){root.innerHTML=`<p class="empty-row">${escapeHTML(res.message||'Could not load logins.')}</p>`;return;}
    const accounts=res.accounts;
    root.innerHTML=accounts.map(a=>`<div class="access-card"><div class="access-card-head"><div class="role-icon"><i class="fa-solid ${a.role==='admin'?'fa-shield-halved':a.role==='agent'?'fa-user-tie':'fa-user'}"></i></div><div><h4>${a.role[0].toUpperCase()+a.role.slice(1)} Login</h4><small>Current ID: ${escapeHTML(a.username)}</small></div></div><button class="btn-friendly-secondary full" data-edit-role="${a.role}"><i class="fa-solid fa-key"></i> Change Login</button></div>`).join('');
    root.querySelectorAll('[data-edit-role]').forEach(btn=>btn.onclick=()=>editRoleLogin(btn.dataset.editRole));
    document.getElementById('googleClientId').value=localStorage.getItem('pf_googleClientId')||'';
}
async function editRoleLogin(role){
    if(state.user?.role!=='developer')return;
    const list=await apiListAccounts();
    const account=list.success?list.accounts.find(a=>a.role===role):null;
    showFormModal({title:`Change ${role} Login`,icon:'fa-key',submitLabel:'Replace Login',intro:'After saving, the old ID and password will stop working immediately — on every device.',fields:[
        {id:'username',label:'New Login ID',required:true,value:account?.username||''},
        {id:'password',label:'New Password',type:'password',required:true,placeholder:'Minimum 6 characters'},
        {id:'googleEmail',label:'Allowed Google Email',type:'email',value:account?.googleEmail||'',placeholder:'Optional'}
    ],onSubmit:async v=>{
        if(v.password.length<6)return showToast('Password must contain at least 6 characters.','danger');
        const result=await apiUpdateAccount({role,username:v.username,password:v.password,googleEmail:v.googleEmail||''});
        if(!result.success)return showToast(result.message||'Could not update login.','danger');
        addAudit('Credentials changed',`${role} login replaced by developer`);renderAccessManager();showToast(`${role} login updated. Old credentials no longer work on any device.`,'success');
    }});
}
function renderAuditLog(){
    const body=document.getElementById('auditTableBody');if(!body)return;
    const logs=getAuditLog(),start=new Date();start.setHours(0,0,0,0);
    document.getElementById('auditTotal').textContent=logs.length;
    document.getElementById('auditToday').textContent=logs.filter(x=>x.timestamp>=start.getTime()).length;
    document.getElementById('auditFailed').textContent=logs.filter(x=>x.action==='Failed login').length;
    body.innerHTML=logs.length?logs.map(x=>`<tr><td data-label="Time">${new Date(x.timestamp).toLocaleString('en-IN')}</td><td data-label="User">${escapeHTML(x.username)}</td><td data-label="Role"><span class="role-chip">${escapeHTML(x.role)}</span></td><td data-label="Activity">${escapeHTML(x.action)}</td><td data-label="Details">${escapeHTML(x.details||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-row">No activity recorded yet.</td></tr>';
}

/* ---------------- ADVANCED LOAN MODULE (2.3 parity) ---------------- */
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function addCycleToDate(dateStr, cycle) {
    const d = new Date(dateStr || Date.now());
    if (cycle === 'Daily') d.setDate(d.getDate() + 1);
    else if (cycle === 'Weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString();
}
function normaliseLoan(l) {
    l.rate = Number(l.rate) || 0;
    l.amount = Number(l.amount) || 0;
    l.payType = l.payType || 'Monthly';
    l.tenure = Number(l.tenure) || 1;
    if (l.principalOutstanding === undefined) l.principalOutstanding = l.status === 'Paid' ? 0 : l.amount;
    // cycleInterest is ALWAYS recalculated from the current principalOutstanding — interest
    // is charged on the outstanding principal only, never on the original loan amount, and
    // never on unpaid interest itself. This auto-recalculates as principal payments come in.
    l.cycleInterest = round2(l.principalOutstanding * l.rate / 100);
    if (l.interestOutstanding === undefined) l.interestOutstanding = 0;
    l.interestPaidTotal = l.interestPaidTotal ?? 0;
    l.principalPaidTotal = l.principalPaidTotal ?? 0;
    l.interestEntries = l.interestEntries || [];
    l.nextInterestDate = l.nextInterestDate || l.sanctionDate || l.dueDate || new Date().toISOString();
    l.history = l.history || [];
    // legacy aliases kept so older code/UI bits that read these still work
    l.interestAmount = l.cycleInterest;
    l.totalPayable = l.totalPayable ?? round2(l.amount + l.cycleInterest);
    l.outstanding = round2(l.principalOutstanding + l.interestOutstanding);
    // Interest accrues independently of repayments — a missed due date never inflates
    // the principal's outstanding balance, it only ever adds to interestOutstanding.
    if (l.status !== 'Paid') {
        l.status = l.interestOutstanding > 0 ? 'Overdue' : 'Active';
    }
}
function calculateDueDate(cycle, tenure, fromDate) {
    const d = fromDate ? new Date(fromDate) : new Date();
    cycle === 'Daily' ? d.setDate(d.getDate()+tenure) : cycle === 'Weekly' ? d.setDate(d.getDate()+tenure*7) : d.setMonth(d.getMonth()+tenure);
    return d.toISOString().slice(0,10);
}
let loanAgentFilter = 'all';
function renderLoanAgentFilterOptions() {
    const sel = document.getElementById('loanAgentFilter');
    if (!sel) return;
    const current = sel.dataset.initialised ? sel.value : loanAgentFilter;
    sel.innerHTML = '<option value="all">All Agents</option><option value="direct">Admin / Direct</option>' +
        agentState.map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
    sel.value = agentState.some(a => a.id === current) || current === 'all' || current === 'direct' ? current : 'all';
    loanAgentFilter = sel.value;
    sel.dataset.initialised = '1';
}
function renderLoansTable() {
    const body=document.getElementById('loansTableBody');
    const q=(document.getElementById('loanSearch')?.value||'').toLowerCase();
    const isAgent = state.user?.role === 'agent';
    let scoped = isAgent ? state.loans.filter(l => l.agentId === state.user.agentId) : state.loans;
    if (!isAgent && loanAgentFilter !== 'all') {
        scoped = scoped.filter(l => loanAgentFilter === 'direct' ? !l.agentId : l.agentId === loanAgentFilter);
    }
    const loans=scoped.filter(l=>[l.name,l.phone,l.status].some(v=>String(v||'').toLowerCase().includes(q)));
    if(!loans.length){body.innerHTML='<tr><td colspan="7" class="empty-row">No matching loan accounts.</td></tr>';return;}
    body.innerHTML=loans.map(l=>{normaliseLoan(l);
        const statusClass=l.status==='Active'?'active':l.status==='Paid'?'paid':'overdue';
        const statusLabel=l.status==='Overdue'?'Pending Overdue Interest':l.status;
        const interestCell=`${fmtINR(l.cycleInterest)}/${l.payType.toLowerCase()}${l.interestOutstanding>0?`<br><small style="color:var(--danger);font-weight:700;">Pending: ${fmtINR(l.interestOutstanding)}</small>`:''}`;
        return `<tr><td class="loan-client-cell" data-label="Client"><strong>${escapeHTML(l.name)}</strong><small>${escapeHTML(l.phone||'No phone')}</small></td><td data-label="Principal">${fmtINR(l.amount)}</td><td data-label="Interest">${interestCell}</td><td data-label="Outstanding">${fmtINR(l.principalOutstanding)}</td><td data-label="Status"><span class="status-pill ${statusClass}">${statusLabel}</span></td><td data-label="Due Date">${l.dueDate||'—'}</td><td data-label="Actions"><div class="loan-action-group"><button class="row-action-btn" onclick="viewLoan('${l.id}')" title="View"><i class="fa-solid fa-eye"></i></button>${l.status!=='Paid'?`<button class="row-action-btn" onclick="repayLoan('${l.id}')" title="Repay"><i class="fa-solid fa-indian-rupee-sign"></i></button><button class="row-action-btn" onclick="addPendingInterest('${l.id}')" title="Add Pending Interest"><i class="fa-solid fa-coins"></i></button>`:''}<button class="row-action-btn" onclick="downloadStatement('${l.id}')" title="Download Statement"><i class="fa-solid fa-file-lines"></i></button><button class="row-action-btn" onclick="editLoan('${l.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="row-action-btn" onclick="deleteLoan('${l.id}')" title="Recycle"><i class="fa-solid fa-trash"></i></button></div></td></tr>`}).join('');
}
function initLoanActions() {
    state.loanTrash=state.loanTrash||[];
    document.getElementById('loanSearch').addEventListener('input',renderLoansTable);
    document.getElementById('loanAgentFilter')?.addEventListener('change',e=>{loanAgentFilter=e.target.value;renderLoansTable();});
    document.getElementById('loanTrashBtn').addEventListener('click',showLoanTrash);
    document.getElementById('addLoanBtn').addEventListener('click',()=>{
        const isAgent = state.user?.role === 'agent';
        const me = isAgent ? agentState.find(a=>a.id===state.user.agentId) : null;
        const fields=[
            {id:'name',label:'Client Name',required:true,placeholder:'e.g. Mukul Sharma'},{id:'phone',label:'Phone Number',required:true,placeholder:'10-digit mobile number'},
            {id:'email',label:'Email',type:'email',placeholder:'Optional'},{id:'guarantor',label:'Guarantor',placeholder:'Name or phone (optional)'},
            {id:'amount',label:'Loan Amount (₹)',type:'number',required:true,min:1,step:'0.01',placeholder:'e.g. 10,000'},{id:'rate',label:'Interest Rate (%)',type:'number',required:true,min:0,step:'0.01',placeholder:'e.g. 5'},
            {id:'payType',label:'Payment Cycle',type:'select',options:[{value:'Monthly',label:'Monthly'},{value:'Weekly',label:'Weekly'},{value:'Daily',label:'Daily'}]},
            {id:'tenure',label:'Number of Payments',type:'number',required:true,min:1,placeholder:'e.g. 12',help:'The due date uses this number and the selected cycle.'},
            {id:'loanDate',label:'Loan Date',type:'date',required:true,value:new Date().toISOString().slice(0,10),help:'Defaults to today — change it to back-date or future-date this loan.'}
        ];
        if (isAgent) {
            fields.push({id:'source',label:'Pay From',type:'select',options:[{value:'agent',label:`My Fund (${fmtINR(me?me.fund:0)})`}]});
        } else {
            fields.push({id:'source',label:'Pay From',type:'select',options:[{value:'cash',label:'Cash Vault'},{value:'online',label:'Online Funds'}]});
        }
        showFormModal({title:'Create New Loan',icon:'fa-hand-holding-dollar',submitLabel:'Create Loan',wide:true,intro:'Enter the customer and loan details. The due date and total payable amount will be calculated automatically.',fields,onSubmit:v=>{
            const amount=Number(v.amount),rate=Number(v.rate)||0,tenure=Number(v.tenure);
            if(!v.name||!amount||!tenure)return showToast('Complete all required fields.','danger');
            if(!/^\d{10}$/.test(v.phone||''))return showToast('Enter a valid 10 digit phone number.','danger');
            if(!v.loanDate)return showToast('Select a loan date.','danger');

            let agentId = null;
            if (isAgent) {
                const agent = agentState.find(a=>a.id===state.user.agentId);
                if (!agent) return showToast('Your agent account could not be found.','danger');
                if (agent.fund < amount) return showToast('Insufficient balance in your fund.','danger');
                agent.fund -= amount;
                agentId = agent.id;
            } else {
                if(state.wallet[v.source]<amount)return showToast('Insufficient funds in selected vault.','danger');
                state.wallet[v.source]-=amount;
            }

            const interestAmount=amount*rate/100;
            const now=new Date(v.loanDate).toISOString();
            state.loans.push({id:genId('loan'),name:v.name,phone:v.phone,email:v.email||'',guarantor:v.guarantor||'',amount,rate,cycleInterest:interestAmount,interestAmount,totalPayable:amount+interestAmount,principalOutstanding:amount,interestOutstanding:0,interestPaidTotal:0,principalPaidTotal:0,interestEntries:[],outstanding:amount,payType:v.payType,tenure,source:isAgent?'agent':v.source,agentId,sanctionDate:now,nextInterestDate:now,dueDate:calculateDueDate(v.payType,tenure,now),status:'Active',history:[{date:Date.now(),type:'Loan issued',amount,mode:isAgent?'agent fund':v.source}]});
            addLog(`New loan issued to ${v.name}`,'expense',amount);
            autoAddToPersonalLedger(`New loan issued to ${v.name}`,'expense',amount);
            saveState();renderAll();showToast('Loan created.','success');
        }});
    });
}
function addPendingInterest(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);
    if (l.status==='Paid') return showToast('This loan is already closed.','warning');
    const dueDate=l.nextInterestDate;
    l.interestEntries.push({id:genId('int'),cycleDue:dueDate,amount:l.cycleInterest,paidAmount:0,paid:false,markedOn:Date.now()});
    l.interestOutstanding=round2(l.interestOutstanding+l.cycleInterest);
    l.nextInterestDate=addCycleToDate(dueDate,l.payType);
    l.history.unshift({date:Date.now(),type:'Pending interest added',amount:l.cycleInterest,mode:'—',note:`Cycle due ${new Date(dueDate).toLocaleDateString('en-IN')}`});
    normaliseLoan(l);
    addLog(`Pending interest added for ${l.name}`,'income',0);
    saveState();renderAll();
    showToast(`${fmtINR(l.cycleInterest)} interest logged as pending overdue interest for ${l.name}.`,'warning');
}
function repayLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);
    if (l.status==='Paid') return showToast('This loan is already closed.','warning');
    const pendingCycles = l.interestEntries.filter(e=>!e.paid).length;
    const applyOptions=[];
    if (l.interestOutstanding>0) applyOptions.push({value:'interest',label:`Pending Interest (${fmtINR(l.interestOutstanding)})${pendingCycles>1?' ['+pendingCycles+' cycles]':''}`});
    applyOptions.push({value:'principal',label:`Principal (${fmtINR(l.principalOutstanding)})`});
    const defaultAmount = l.interestOutstanding > 0 ? l.interestOutstanding : l.principalOutstanding;
    const cycleNote = pendingCycles > 1 ? ` · ⚠️ ${pendingCycles} months pending — full amount pre-filled for full XP` : '';
    const fields=[{id:'applyTo',label:'Apply Payment To',type:'select',options:applyOptions},{id:'amount',label:'Amount (₹)',type:'number',required:true,min:0.01,step:'0.01',value:defaultAmount}];
    if (!l.agentId) fields.push({id:'mode',label:'Receive Into',type:'select',options:[{value:'cash',label:'Cash Vault'},{value:'online',label:'Online Funds'}]});
    fields.push({id:'note',label:'Note'});
    showFormModal({title:`Receive Payment — ${l.name}`,icon:'fa-indian-rupee-sign',submitLabel:'Record Payment',intro:`Pending interest: ${fmtINR(l.interestOutstanding)} · Principal outstanding: ${fmtINR(l.principalOutstanding)}${cycleNote}`,fields,onSubmit:v=>{
        const a=Number(v.amount);const applyTo=v.applyTo||(l.interestOutstanding>0?'interest':'principal');
        const cap=applyTo==='interest'?l.interestOutstanding:l.principalOutstanding;
        if(!a||a<=0)return showToast('Enter a valid amount.','danger');
        if(a>cap+0.01)return showToast(`Payment exceeds ${applyTo==='interest'?'pending interest due':'outstanding principal'}.`,'danger');
        if (applyTo==='interest') {
            l.interestOutstanding=round2(l.interestOutstanding-a);
            l.interestPaidTotal=round2((l.interestPaidTotal||0)+a);
            let remain=a;
            let entriesNewlySettled=0;
            let xpFromSettledEntries=0;
            for (const entry of l.interestEntries) {
                if (entry.paid || remain<=0) continue;
                const owed=round2(entry.amount-(entry.paidAmount||0));
                const pay=Math.min(remain,owed);
                entry.paidAmount=round2((entry.paidAmount||0)+pay);
                remain=round2(remain-pay);
                if (entry.paidAmount>=entry.amount-0.01 && !entry.paid) {
                    entry.paid=true;
                    entriesNewlySettled++;
                    xpFromSettledEntries=round2(xpFromSettledEntries+(entry.amount||0));
                }
            }
            // XP is only awarded once interest is FULLY/successfully collected —
            // missed/overdue/partial interest never generates XP. XP earned per
            // fully-settled interest cycle equals the actual ₹ interest amount collected
            // (e.g. ₹500 interest collected → +500 XP).
            if (entriesNewlySettled > 0 && l.agentId && typeof awardAgentXP === 'function') {
                awardAgentXP(l.agentId, xpFromSettledEntries, l.name);
            }
        } else {
            l.principalOutstanding=round2(l.principalOutstanding-a);
            l.principalPaidTotal=round2((l.principalPaidTotal||0)+a);
        }
        const histType=applyTo==='interest'?'Interest Payment':'Principal Payment';
        const rcptId = 'PF-' + Date.now().toString(36).toUpperCase();
        const rcptTs = Date.now();
        if (l.agentId) {
            const agent=agentState.find(ag=>ag.id===l.agentId);
            // Collected money goes to a separate pool — it must NOT be added back to
            // agent.fund. The fund only decreases when loans are issued and is replenished
            // only when admin/dev manually allocates more via "Give Fund".
            if (agent) agent.collectionPool=round2((agent.collectionPool||0)+a);
            l.history.unshift({date:rcptTs,type:histType,amount:a,mode:'agent fund',note:v.note||'',receiptId:rcptId});
        } else {
            state.wallet[v.mode]+=a;
            l.history.unshift({date:rcptTs,type:histType,amount:a,mode:v.mode,note:v.note||'',receiptId:rcptId});
        }
        if (l.principalOutstanding<=0 && l.interestOutstanding<=0) l.status='Paid';
        normaliseLoan(l);
        addLog(`${histType} received from ${l.name}`,'income',a);autoAddToPersonalLedger(`${histType} received from ${l.name}`,'income',a);saveState();renderAll();
        // Show receipt toast — offers to open the printable invoice
        if (typeof offerReceipt === 'function') {
            const payMode = l.agentId ? 'agent fund' : (v.mode || '—');
            offerReceipt(l, a, histType, payMode, rcptId, rcptTs);
        } else {
            showToast('Payment recorded.','success');
        }
    }});
}
function viewLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);const o=document.createElement('div');o.className='modal-overlay modal-wide';
    const statusClass=l.status==='Active'?'active':l.status==='Paid'?'paid':'overdue';
    const statusLabel=l.status==='Overdue'?'Pending Overdue Interest':l.status;
    const canEditDates=state.user?.role==='admin'||state.user?.role==='developer';
    o.innerHTML=`<div class="modal-card"><div class="modal-header"><div class="modal-icon"><i class="fa-solid fa-address-card"></i></div><div class="loan-profile-heading"><h3>${escapeHTML(l.name)}</h3><small>${statusLabel} loan account</small></div><button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button></div><div class="loan-profile-body"><div class="loan-hero"><div><small>Principal still due</small><strong>${fmtINR(l.principalOutstanding)}</strong></div><span class="status-pill ${statusClass}">${statusLabel}</span></div>${l.interestOutstanding>0?`<div class="loan-hero" style="margin-top:8px;"><div><small>Pending overdue interest</small><strong style="color:var(--danger);">${fmtINR(l.interestOutstanding)}</strong></div></div>`:''}<div class="loan-detail-grid"><div class="loan-detail-item"><small>Phone & Email</small>${escapeHTML(l.phone||'Not provided')}<br><span>${escapeHTML(l.email||'No email')}</span></div><div class="loan-detail-item"><small>Guarantor</small>${escapeHTML(l.guarantor||'Not provided')}</div><div class="loan-detail-item"><small>Principal</small>${fmtINR(l.amount)}</div><div class="loan-detail-item"><small>Interest (${l.rate}%)</small>${fmtINR(l.cycleInterest)} / ${l.payType}</div><div class="loan-detail-item"><small>Payment Plan</small>${l.payType||'Monthly'} · ${l.tenure||'—'} payments</div><div class="loan-detail-item"><small>Due Date</small>${l.dueDate||'Not set'}</div><div class="loan-detail-item"><small>Interest Paid to Date</small>${fmtINR(l.interestPaidTotal)}</div><div class="loan-detail-item"><small>Next Interest Cycle</small>${new Date(l.nextInterestDate).toLocaleDateString('en-IN')}</div></div><div class="loan-profile-actions">${l.status!=='Paid'?`<button class="btn-friendly-primary" data-repay>Receive Payment</button><button class="btn-friendly-secondary" data-mark-interest>Add Pending Interest</button>`:''}<button class="btn-friendly-secondary" data-edit>Edit Details</button><button class="btn-friendly-secondary" data-download-stmt><i class="fa-solid fa-file-lines"></i> Download Statement</button></div><h4 class="statement-title">Interest entries</h4><div class="table-responsive loan-statement"><table><thead><tr><th>Cycle Due</th><th>Amount</th><th>Status</th>${canEditDates?'<th></th>':''}</tr></thead><tbody>${l.interestEntries.length?l.interestEntries.map((e,idx)=>`<tr><td data-label="Cycle Due">${new Date(e.cycleDue).toLocaleDateString('en-IN')}</td><td data-label="Amount">${fmtINR(e.amount)}</td><td data-label="Status"><span class="status-pill ${e.paid?'paid':'overdue'}">${e.paid?'Paid':'Pending Overdue'}</span></td>${canEditDates?`<td><button class="row-action-btn" data-edit-interest-date="${idx}" title="Edit Date (admin/dev only)"><i class="fa-solid fa-pen"></i></button></td>`:''}</tr>`).join(''):`<tr><td colspan="${canEditDates?4:3}" class="empty-row">No interest entries marked yet.</td></tr>`}</tbody></table></div><h4 class="statement-title">Payment history</h4><div class="table-responsive loan-statement"><table><thead><tr><th>Date</th><th>Entry</th><th>Mode</th><th>Amount</th><th>Note</th></tr></thead><tbody>${l.history.length?l.history.map((h,idx)=>`<tr><td data-label="Date">${new Date(h.date).toLocaleDateString('en-IN')}${canEditDates?` <button class="row-action-btn" data-edit-history-date="${idx}" title="Edit Date (admin/dev only)"><i class="fa-solid fa-pen"></i></button>`:''}</td><td data-label="Entry">${escapeHTML(h.type)}</td><td data-label="Mode">${escapeHTML(h.mode||'—')}</td><td data-label="Amount">${fmtINR(h.amount||0)}</td><td data-label="Note">${h.note?`<button class="row-action-btn" data-view-note="${idx}" title="View Note"><i class="fa-solid fa-eye"></i></button>`:'—'} ${(h.type==='Interest Payment'||h.type==='Principal Payment')?`<button class="row-action-btn" data-view-receipt="${idx}" title="Download Receipt"><i class="fa-solid fa-file-invoice"></i></button>`:''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-row">No payments recorded yet.</td></tr>'}</tbody></table></div></div></div>`;document.body.appendChild(o);o.querySelector('.modal-close-btn').onclick=()=>o.remove();o.querySelector('[data-repay]')?.addEventListener('click',()=>{o.remove();repayLoan(id)});o.querySelector('[data-mark-interest]')?.addEventListener('click',()=>{o.remove();addPendingInterest(id)});o.querySelector('[data-edit]').onclick=()=>{o.remove();editLoan(id)};o.querySelectorAll('[data-view-note]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();showNoteModal(l.history[Number(btn.dataset.viewNote)]?.note||'');}));o.querySelectorAll('[data-edit-history-date]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();o.remove();editHistoryEntryDate(id,Number(btn.dataset.editHistoryDate));}));o.querySelectorAll('[data-edit-interest-date]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();o.remove();editInterestEntryDate(id,Number(btn.dataset.editInterestDate));}));o.onclick=e=>{if(e.target===o)o.remove();};o.querySelectorAll('[data-view-receipt]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();if(typeof downloadReceiptFromHistory==='function')downloadReceiptFromHistory(id,Number(btn.dataset.viewReceipt));}));o.querySelector('[data-download-stmt]')?.addEventListener('click',()=>{o.remove();if(typeof downloadStatement==='function')downloadStatement(id);});
}
function editHistoryEntryDate(loanId, idx) {
    const isAdminOrDev=state.user?.role==='admin'||state.user?.role==='developer';
    if (!isAdminOrDev) return showToast('Only admin or developer can edit entry dates.','danger');
    const l=state.loans.find(x=>x.id===loanId);if(!l)return;
    const h=l.history[idx];if(!h)return;
    const current=new Date(h.date).toISOString().slice(0,10);
    showFormModal({title:'Edit Entry Date',icon:'fa-calendar-days',submitLabel:'Update Date',intro:`${h.type} — ${fmtINR(h.amount||0)}. Useful for backdating past records.`,fields:[{id:'entryDate',label:'Entry Date',type:'date',required:true,value:current}],onSubmit:v=>{
        if (!v.entryDate) return showToast('Select a date.','danger');
        const original=new Date(h.date);const updated=new Date(v.entryDate);
        updated.setHours(original.getHours(),original.getMinutes(),original.getSeconds());
        h.date=updated.getTime();
        addAudit('Loan entry date edited',`${state.user.username} backdated a "${h.type}" entry for ${l.name} to ${v.entryDate}`);
        saveState();renderAll();showToast('Entry date updated.','success');
        viewLoan(loanId);
    }});
}
function editInterestEntryDate(loanId, idx) {
    const isAdminOrDev=state.user?.role==='admin'||state.user?.role==='developer';
    if (!isAdminOrDev) return showToast('Only admin or developer can edit entry dates.','danger');
    const l=state.loans.find(x=>x.id===loanId);if(!l)return;
    const e=l.interestEntries[idx];if(!e)return;
    const current=new Date(e.cycleDue).toISOString().slice(0,10);
    showFormModal({title:'Edit Cycle Due Date',icon:'fa-calendar-days',submitLabel:'Update Date',intro:`Interest cycle of ${fmtINR(e.amount)}. Useful for backdating past records.`,fields:[{id:'cycleDate',label:'Cycle Due Date',type:'date',required:true,value:current}],onSubmit:v=>{
        if (!v.cycleDate) return showToast('Select a date.','danger');
        e.cycleDue=new Date(v.cycleDate).toISOString();
        addAudit('Interest cycle date edited',`${state.user.username} backdated an interest cycle for ${l.name} to ${v.cycleDate}`);
        saveState();renderAll();showToast('Cycle date updated.','success');
        viewLoan(loanId);
    }});
}
function showNoteModal(note) {
    const existing=document.getElementById('noteViewOverlay');if(existing)existing.remove();
    const o=document.createElement('div');o.id='noteViewOverlay';o.className='modal-overlay';
    o.innerHTML=`<div class="modal-card"><div class="modal-header"><div class="modal-icon"><i class="fa-solid fa-note-sticky"></i></div><h3>Note</h3><button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button></div><div class="modal-body"><p style="white-space:pre-wrap;line-height:1.6;">${escapeHTML(note||'No note added.')}</p></div></div>`;
    document.body.appendChild(o);
    o.querySelector('.modal-close-btn').onclick=()=>o.remove();
    o.onclick=e=>{if(e.target===o)o.remove();};
}
function editLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);
    const isAdmin=state.user?.role!=='agent';
    const fields=[{id:'name',label:'Client Name',required:true,value:l.name},{id:'phone',label:'Phone',required:true,value:l.phone||''},{id:'email',label:'Email',type:'email',value:l.email||''},{id:'guarantor',label:'Guarantor',value:l.guarantor||''}];
    if (isAdmin) fields.push({id:'loanDate',label:'Loan Date',type:'date',value:(l.sanctionDate||'').slice(0,10),help:'Admin-only — changes when this loan was issued and recalculates the due date.'});
    fields.push({id:'dueDate',label:'Due Date',type:'date',value:l.dueDate||''});
    showFormModal({title:`Edit ${l.name}`,icon:'fa-pen',submitLabel:'Save Changes',wide:true,fields,onSubmit:v=>{
        l.name=v.name||l.name;l.phone=v.phone||l.phone;l.email=v.email;l.guarantor=v.guarantor;
        if (isAdmin && v.loanDate) {
            l.sanctionDate=new Date(v.loanDate).toISOString();
            if (!l.interestEntries.length) l.nextInterestDate=l.sanctionDate;
            l.dueDate=v.dueDate||calculateDueDate(l.payType,l.tenure,l.sanctionDate);
        } else {
            l.dueDate=v.dueDate||l.dueDate;
        }
        saveState();renderAll();showToast('Loan updated.','success');
    }});
}
function deleteLoan(id) {
    if(!confirm('Move this loan to the recycle bin?'))return;const i=state.loans.findIndex(l=>l.id===id);if(i<0)return;state.loanTrash=state.loanTrash||[];state.loanTrash.unshift({...state.loans[i],deletedAt:Date.now()});state.loans.splice(i,1);saveState();renderAll();showToast('Loan moved to recycle bin.','warning');
}
function showLoanTrash() {
    const o=document.createElement('div');o.className='modal-overlay modal-wide';state.loanTrash=state.loanTrash||[];o.innerHTML=`<div class="modal-card"><div class="modal-header"><h3>Recycle Bin</h3><button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button></div><div class="table-responsive"><table><thead><tr><th>Client</th><th>Amount</th><th>Deleted</th><th>Action</th></tr></thead><tbody>${state.loanTrash.length?state.loanTrash.map(l=>`<tr><td data-label="Client">${escapeHTML(l.name)}</td><td data-label="Amount">${fmtINR(l.amount)}</td><td data-label="Deleted">${new Date(l.deletedAt).toLocaleString('en-IN')}</td><td data-label="Action"><button class="row-action-btn" data-restore="${l.id}"><i class="fa-solid fa-rotate-left"></i></button></td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">Recycle bin is empty.</td></tr>'}</tbody></table></div></div>`;document.body.appendChild(o);o.querySelector('.modal-close-btn').onclick=()=>o.remove();o.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{const i=state.loanTrash.findIndex(l=>l.id===b.dataset.restore);if(i>=0){const [l]=state.loanTrash.splice(i,1);delete l.deletedAt;state.loans.push(l);saveState();renderAll();o.remove();showToast('Loan restored.','success');}});
}

/* ---------------- UTIL ---------------- */
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ---------------- MASTER RENDER ---------------- */
function renderAll() {
    renderStatCards();
    renderLoanAgentFilterOptions();
    renderLoansTable();
    renderLedgerTable();
    renderSosTable();
    renderDevConsole();
    if (typeof devWipePopulateAgents === 'function') devWipePopulateAgents();
    if (typeof devSelPopulateAgents  === 'function') devSelPopulateAgents();
    if (typeof devSelRefreshIfOpen   === 'function') devSelRefreshIfOpen();
    renderAgentManager();
    if (typeof renderAnalyticsCharts === 'function') renderAnalyticsCharts();
    if (typeof renderMyRankPage === 'function') renderMyRankPage();
    if (typeof renderAgentDashboardPanel === 'function') renderAgentDashboardPanel();
    if (typeof kycSyncBadgeAndMetrics === 'function') kycSyncBadgeAndMetrics();
    if (document.getElementById('page-settings')?.classList.contains('active') && typeof refreshKycPageLight === 'function') refreshKycPageLight();
    if (document.getElementById('page-kyc-approvals')?.classList.contains('active') && typeof renderKycApprovalsPage === 'function') renderKycApprovalsPage();
    if (document.getElementById('page-clients')?.classList.contains('active') && typeof renderClientsPage === 'function') renderClientsPage();
    if (document.getElementById('page-adminledger')?.classList.contains('active') && typeof renderAdminLedgerPage === 'function') renderAdminLedgerPage();
    if (document.getElementById('page-schedule')?.classList.contains('active') && typeof renderSchedulePage === 'function') renderSchedulePage();
    if (typeof updateNotifBadge === 'function') updateNotifBadge();
    if (typeof updateXPWithdrawalBadge === 'function') updateXPWithdrawalBadge();
}
