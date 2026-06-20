/* ============================================================
   wallet.js — Business logic for every function in the sidebar
   ============================================================ */

function renderStatCards() {
    const total = state.wallet.cash + state.wallet.online;
    const activeLoanTotal = state.loans.filter(l => l.status === 'Active').reduce((s, l) => s + l.amount, 0);

    document.getElementById('statTotalBalance').textContent = fmtINR(total);
    document.getElementById('statCashVault').textContent = fmtINR(state.wallet.cash);
    document.getElementById('statOnlineFunds').textContent = fmtINR(state.wallet.online);
    document.getElementById('statActiveLoans').textContent = fmtINR(activeLoanTotal);
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
        const name = prompt('Client name:');
        if (!name) return;
        const amount = parseFloat(prompt('Loan amount (₹):') || '0');
        if (!amount || amount <= 0) return showToast('Invalid amount.', 'danger');
        const dueDate = prompt('Due date (YYYY-MM-DD), optional:') || '';

        state.loans.push({ id: genId('loan'), name, amount, status: 'Active', dueDate, history: [] });
        addLog(`New loan issued to ${name}`, 'expense', amount);
        saveState();
        renderAll();
        showToast('Loan created.', 'success');
    });
}

function markLoanPaid(id) {
    const loan = state.loans.find(l => l.id === id);
    if (!loan) return;
    loan.status = 'Paid';
    addLog(`Loan repaid by ${loan.name}`, 'income', loan.amount);
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
    const body = document.getElementById('ledgerTableBody');
    if (!state.logs.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty-row">No transactions logged yet.</td></tr>';
        return;
    }
    body.innerHTML = state.logs.slice(0, 100).map(log => `
        <tr>
            <td>${new Date(log.timestampMs).toLocaleString('en-IN')}</td>
            <td>${escapeHTML(log.description)}</td>
            <td><span class="status-pill ${log.typeClass === 'income' ? 'paid' : 'active'}">${log.typeClass}</span></td>
            <td>${log.impactStr}</td>
        </tr>
    `).join('');
}

function initLedgerActions() {
    document.getElementById('exportLedgerBtn').addEventListener('click', () => {
        if (!state.logs.length) return showToast('No data to export.', 'warning');
        const header = 'Date,Description,Type,Impact\n';
        const rows = state.logs.map(l => `"${new Date(l.timestampMs).toLocaleString('en-IN')}","${l.description}","${l.typeClass}","${l.impactStr}"`).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'pocket_finance_ledger.csv'; a.click();
        URL.revokeObjectURL(url);
        showToast('Ledger exported.', 'success');
    });
}

/* ---------------- CLIENTS ---------------- */
function renderClientsTable() {
    const body = document.getElementById('clientsTableBody');
    if (!state.clients.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty-row">No clients added yet.</td></tr>';
        return;
    }
    body.innerHTML = state.clients.map(c => `
        <tr>
            <td>${escapeHTML(c.name)}</td>
            <td>${escapeHTML(c.phone || '—')}</td>
            <td>${fmtINR(c.outstanding)}</td>
            <td><button class="row-action-btn" onclick="deleteClient('${c.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button></td>
        </tr>
    `).join('');
}

function initClientActions() {
    document.getElementById('addClientBtn').addEventListener('click', () => {
        const name = prompt('Client name:');
        if (!name) return;
        const phone = prompt('Phone number (optional):') || '';
        state.clients.push({ id: genId('client'), name, phone, outstanding: 0 });
        saveState();
        renderAll();
        showToast('Client added.', 'success');
    });
}

function deleteClient(id) {
    if (!confirm('Remove this client?')) return;
    state.clients = state.clients.filter(c => c.id !== id);
    saveState();
    renderAll();
    showToast('Client removed.', 'warning');
}

/* ---------------- SOS ---------------- */
function renderSosTable() {
    const body = document.getElementById('sosTableBody');
    if (!state.sos.length) {
        body.innerHTML = '<tr><td colspan="3" class="empty-row">No SOS tokens raised yet.</td></tr>';
    } else {
        body.innerHTML = state.sos.map(s => `
            <tr>
                <td>${new Date(s.raisedOn).toLocaleString('en-IN')}</td>
                <td>${escapeHTML(s.reason)}</td>
                <td><span class="status-pill active">${s.status}</span></td>
            </tr>
        `).join('');
    }
    updateBadge('sosBadge', state.sos.filter(s => s.status === 'Open').length);
}

function initSosActions() {
    document.getElementById('raiseSosBtn').addEventListener('click', () => {
        const reason = prompt('Reason for SOS:');
        if (!reason) return;
        state.sos.unshift({ id: genId('sos'), raisedOn: Date.now(), reason, status: 'Open' });
        saveState();
        renderAll();
        showToast('SOS raised. Admin has been notified.', 'warning');
    });
}

/* ---------------- ADMIN PANEL ---------------- */
function initAdminActions() {
    document.getElementById('manageAgentsBtn').addEventListener('click', () => {
        const name = prompt('Agent name to add:');
        if (!name) return;
        const fund = parseFloat(prompt('Fund allocation (₹):') || '0');
        agentState.push({ id: genId('agent'), name, fund });
        saveState();
        renderAll();
        showToast(`Agent "${name}" added with ${fmtINR(fund)} allocated.`, 'success');
    });

    document.getElementById('connectDbBtn').addEventListener('click', () => {
        const url = document.getElementById('sharedDbUrl').value.trim();
        if (!url) return showToast('Paste a valid Apps Script URL first.', 'danger');
        localStorage.setItem('pf_sharedDbUrl', url);
        showToast('Shared DB URL saved. Wire it up in wallet.js to go live.', 'info');
    });

    const savedUrl = localStorage.getItem('pf_sharedDbUrl');
    if (savedUrl) document.getElementById('sharedDbUrl').value = savedUrl;
}

/* ---------------- DEV CONSOLE ---------------- */
function renderDevConsole() {
    const out = document.getElementById('devStateOutput');
    if (!out) return;
    out.textContent = JSON.stringify({ state, agentState }, null, 2);
}

function initDevConsoleActions() {
    document.getElementById('refreshStateBtn').addEventListener('click', renderDevConsole);
    document.getElementById('resetStateBtn').addEventListener('click', () => {
        if (!confirm('This wipes ALL local data. Continue?')) return;
        resetState();
        renderAll();
        showToast('All data reset.', 'warning');
    });
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
    renderLoansTable();
    renderLedgerTable();
    renderClientsTable();
    renderSosTable();
    renderDevConsole();
    if (typeof renderAnalyticsCharts === 'function') renderAnalyticsCharts();
}
