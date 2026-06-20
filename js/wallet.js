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
        showFormModal({
            title: 'Add Client',
            icon: 'fa-user-plus',
            submitLabel: 'Add Client',
            fields: [
                { id: 'name', label: 'Client Name', required: true, placeholder: 'e.g. Rahul Verma' },
                { id: 'phone', label: 'Phone Number', placeholder: 'Optional' }
            ],
            onSubmit: (v) => {
                if (!v.name) return showToast('Client name is required.', 'danger');
                state.clients.push({ id: genId('client'), name: v.name, phone: v.phone || '', outstanding: 0 });
                saveState();
                renderAll();
                showToast('Client added.', 'success');
            }
        });
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
        showFormModal({
            title: 'Raise SOS',
            icon: 'fa-triangle-exclamation',
            submitLabel: 'Raise SOS',
            fields: [
                { id: 'reason', label: 'Reason', required: true, placeholder: 'e.g. Client refusing to repay' }
            ],
            onSubmit: (v) => {
                if (!v.reason) return showToast('Please describe the issue.', 'danger');
                state.sos.unshift({ id: genId('sos'), raisedOn: Date.now(), reason: v.reason, status: 'Open' });
                saveState();
                renderAll();
                showToast('SOS raised. Admin has been notified.', 'warning');
            }
        });
    });
}

/* ---------------- ADMIN PANEL ---------------- */
function initAdminActions() {
    document.getElementById('manageAgentsBtn').addEventListener('click', () => {
        showFormModal({
            title: 'Add Agent',
            icon: 'fa-users-gear',
            submitLabel: 'Add Agent',
            fields: [
                { id: 'name', label: 'Agent Name', required: true, placeholder: 'e.g. Priya Singh' },
                { id: 'fund', label: 'Fund Allocation (₹)', type: 'number', required: true, min: 0, step: '0.01', placeholder: '0.00' }
            ],
            onSubmit: (v) => {
                const fund = parseFloat(v.fund);
                if (!v.name) return showToast('Agent name is required.', 'danger');
                if (!fund || fund <= 0) return showToast('Invalid fund amount.', 'danger');
                agentState.push({ id: genId('agent'), name: v.name, fund });
                saveState();
                renderAll();
                showToast(`Agent "${v.name}" added with ${fmtINR(fund)} allocated.`, 'success');
            }
        });
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

function renderAccessManager(){
    const root=document.getElementById('accessAccounts');if(!root)return;
    const accounts=getAccounts().filter(a=>a.role!=='developer');
    root.innerHTML=accounts.map(a=>`<div class="access-card"><div class="access-card-head"><div class="role-icon"><i class="fa-solid ${a.role==='admin'?'fa-shield-halved':a.role==='agent'?'fa-user-tie':'fa-user'}"></i></div><div><h4>${a.role[0].toUpperCase()+a.role.slice(1)} Login</h4><small>Current ID: ${escapeHTML(a.username)}</small></div></div><button class="btn-friendly-secondary full" data-edit-role="${a.role}"><i class="fa-solid fa-key"></i> Change Login</button></div>`).join('');
    root.querySelectorAll('[data-edit-role]').forEach(btn=>btn.onclick=()=>editRoleLogin(btn.dataset.editRole));
    document.getElementById('googleClientId').value=localStorage.getItem('pf_googleClientId')||'';
}
function editRoleLogin(role){
    if(state.user?.role!=='developer')return;
    const accounts=getAccounts(),account=accounts.find(a=>a.role===role);
    showFormModal({title:`Change ${role} Login`,icon:'fa-key',submitLabel:'Replace Login',intro:'After saving, the old ID and password will stop working immediately.',fields:[
        {id:'username',label:'New Login ID',required:true,value:account.username},
        {id:'password',label:'New Password',type:'password',required:true,placeholder:'Minimum 6 characters'},
        {id:'googleEmail',label:'Allowed Google Email',type:'email',value:account.googleEmail||'',placeholder:'Optional'}
    ],onSubmit:v=>{
        if(v.password.length<6)return showToast('Password must contain at least 6 characters.','danger');
        if(accounts.some(a=>a.role!==role&&a.username.toLowerCase()===v.username.toLowerCase()))return showToast('That login ID is already in use.','danger');
        account.username=v.username;account.password=v.password;account.googleEmail=v.googleEmail||'';saveAccounts(accounts);
        addAudit('Credentials changed',`${role} login replaced by developer`);renderAccessManager();showToast(`${role} login updated. Old credentials no longer work.`,'success');
    }});
}
function renderAuditLog(){
    const body=document.getElementById('auditTableBody');if(!body)return;
    const logs=getAuditLog(),start=new Date();start.setHours(0,0,0,0);
    document.getElementById('auditTotal').textContent=logs.length;
    document.getElementById('auditToday').textContent=logs.filter(x=>x.timestamp>=start.getTime()).length;
    document.getElementById('auditFailed').textContent=logs.filter(x=>x.action==='Failed login').length;
    body.innerHTML=logs.length?logs.map(x=>`<tr><td>${new Date(x.timestamp).toLocaleString('en-IN')}</td><td>${escapeHTML(x.username)}</td><td><span class="role-chip">${escapeHTML(x.role)}</span></td><td>${escapeHTML(x.action)}</td><td>${escapeHTML(x.details||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-row">No activity recorded yet.</td></tr>';
}

/* ---------------- ADVANCED LOAN MODULE (2.3 parity) ---------------- */
function normaliseLoan(l) {
    l.rate = Number(l.rate) || 0;
    l.interestAmount = l.interestAmount ?? Number(l.amount) * l.rate / 100;
    l.totalPayable = l.totalPayable ?? Number(l.amount) + l.interestAmount;
    l.outstanding = l.outstanding ?? (l.status === 'Paid' ? 0 : l.totalPayable);
    l.history = l.history || [];
}
function calculateDueDate(cycle, tenure) {
    const d = new Date();
    cycle === 'Daily' ? d.setDate(d.getDate()+tenure) : cycle === 'Weekly' ? d.setDate(d.getDate()+tenure*7) : d.setMonth(d.getMonth()+tenure);
    return d.toISOString().slice(0,10);
}
function renderLoansTable() {
    const body=document.getElementById('loansTableBody');
    const q=(document.getElementById('loanSearch')?.value||'').toLowerCase();
    const loans=state.loans.filter(l=>[l.name,l.phone,l.status].some(v=>String(v||'').toLowerCase().includes(q)));
    if(!loans.length){body.innerHTML='<tr><td colspan="7" class="empty-row">No matching loan accounts.</td></tr>';return;}
    body.innerHTML=loans.map(l=>{normaliseLoan(l);return `<tr><td class="loan-client-cell"><strong>${escapeHTML(l.name)}</strong><small>${escapeHTML(l.phone||'No phone')}</small></td><td>${fmtINR(l.amount)}</td><td>${fmtINR(l.interestAmount)}</td><td>${fmtINR(l.outstanding)}</td><td><span class="status-pill ${l.status==='Active'?'active':'paid'}">${l.status}</span></td><td>${l.dueDate||'—'}</td><td><div class="loan-action-group"><button class="row-action-btn" onclick="viewLoan('${l.id}')" title="View"><i class="fa-solid fa-eye"></i></button>${l.status==='Active'?`<button class="row-action-btn" onclick="repayLoan('${l.id}')" title="Repay"><i class="fa-solid fa-indian-rupee-sign"></i></button>`:''}<button class="row-action-btn" onclick="editLoan('${l.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="row-action-btn" onclick="deleteLoan('${l.id}')" title="Recycle"><i class="fa-solid fa-trash"></i></button></div></td></tr>`}).join('');
}
function initLoanActions() {
    state.loanTrash=state.loanTrash||[];
    document.getElementById('loanSearch').addEventListener('input',renderLoansTable);
    document.getElementById('loanTrashBtn').addEventListener('click',showLoanTrash);
    document.getElementById('addLoanBtn').addEventListener('click',()=>showFormModal({title:'Create New Loan',icon:'fa-hand-holding-dollar',submitLabel:'Create Loan',wide:true,intro:'Enter the customer and loan details. The due date and total payable amount will be calculated automatically.',fields:[
        {id:'name',label:'Client Name',required:true,placeholder:'e.g. Mukul Sharma'},{id:'phone',label:'Phone Number',required:true,placeholder:'10-digit mobile number'},
        {id:'email',label:'Email',type:'email',placeholder:'Optional'},{id:'guarantor',label:'Guarantor',placeholder:'Name or phone (optional)'},
        {id:'amount',label:'Loan Amount (₹)',type:'number',required:true,min:1,step:'0.01',placeholder:'e.g. 10,000'},{id:'rate',label:'Interest Rate (%)',type:'number',required:true,min:0,step:'0.01',placeholder:'e.g. 5'},
        {id:'payType',label:'Payment Cycle',type:'select',options:[{value:'Monthly',label:'Monthly'},{value:'Weekly',label:'Weekly'},{value:'Daily',label:'Daily'}]},
        {id:'tenure',label:'Number of Payments',type:'number',required:true,min:1,placeholder:'e.g. 12',help:'The due date uses this number and the selected cycle.'},{id:'source',label:'Pay From',type:'select',options:[{value:'cash',label:'Cash Vault'},{value:'online',label:'Online Funds'}]}
    ],onSubmit:v=>{const amount=Number(v.amount),rate=Number(v.rate)||0,tenure=Number(v.tenure);if(!v.name||!amount||!tenure)return showToast('Complete all required fields.','danger');if(!/^\d{10}$/.test(v.phone||''))return showToast('Enter a valid 10 digit phone number.','danger');if(state.wallet[v.source]<amount)return showToast('Insufficient funds in selected vault.','danger');const interestAmount=amount*rate/100;state.wallet[v.source]-=amount;state.loans.push({id:genId('loan'),name:v.name,phone:v.phone,email:v.email||'',guarantor:v.guarantor||'',amount,rate,interestAmount,totalPayable:amount+interestAmount,outstanding:amount+interestAmount,payType:v.payType,tenure,source:v.source,sanctionDate:new Date().toISOString(),dueDate:calculateDueDate(v.payType,tenure),status:'Active',history:[{date:Date.now(),type:'Loan issued',amount,mode:v.source}]});addLog(`New loan issued to ${v.name}`,'expense',amount);saveState();renderAll();showToast('Loan created.','success');}}));
}
function repayLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);
    showFormModal({title:`Receive Payment — ${l.name}`,icon:'fa-indian-rupee-sign',submitLabel:'Record Payment',fields:[{id:'amount',label:`Amount (Outstanding ${fmtINR(l.outstanding)})`,type:'number',required:true,min:1,step:'0.01'},{id:'mode',label:'Receive Into',type:'select',options:[{value:'cash',label:'Cash Vault'},{value:'online',label:'Online Funds'}]},{id:'note',label:'Note'}],onSubmit:v=>{const a=Number(v.amount);if(!a||a>l.outstanding)return showToast('Payment exceeds outstanding amount.','danger');l.outstanding-=a;l.status=l.outstanding===0?'Paid':'Active';l.history.unshift({date:Date.now(),type:'Repayment',amount:a,mode:v.mode,note:v.note||''});state.wallet[v.mode]+=a;addLog(`Repayment received from ${l.name}`,'income',a);saveState();renderAll();showToast('Payment recorded.','success');}});
}
function viewLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;normaliseLoan(l);const o=document.createElement('div');o.className='modal-overlay modal-wide';
    o.innerHTML=`<div class="modal-card"><div class="modal-header"><div class="modal-icon"><i class="fa-solid fa-address-card"></i></div><div class="loan-profile-heading"><h3>${escapeHTML(l.name)}</h3><small>${l.status} loan account</small></div><button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button></div><div class="loan-profile-body"><div class="loan-hero"><div><small>Amount still due</small><strong>${fmtINR(l.outstanding)}</strong></div><span class="status-pill ${l.status==='Active'?'active':'paid'}">${l.status}</span></div><div class="loan-detail-grid"><div class="loan-detail-item"><small>Phone & Email</small>${escapeHTML(l.phone||'Not provided')}<br><span>${escapeHTML(l.email||'No email')}</span></div><div class="loan-detail-item"><small>Guarantor</small>${escapeHTML(l.guarantor||'Not provided')}</div><div class="loan-detail-item"><small>Principal</small>${fmtINR(l.amount)}</div><div class="loan-detail-item"><small>Interest (${l.rate}%)</small>${fmtINR(l.interestAmount)}</div><div class="loan-detail-item"><small>Payment Plan</small>${l.payType||'Monthly'} · ${l.tenure||'—'} payments</div><div class="loan-detail-item"><small>Due Date</small>${l.dueDate||'Not set'}</div></div><div class="loan-profile-actions">${l.status==='Active'?`<button class="btn-friendly-primary" data-repay>Receive Payment</button>`:''}<button class="btn-friendly-secondary" data-edit>Edit Details</button></div><h4 class="statement-title">Payment history</h4><div class="table-responsive loan-statement"><table><thead><tr><th>Date</th><th>Entry</th><th>Mode</th><th>Amount</th></tr></thead><tbody>${l.history.length?l.history.map(h=>`<tr><td>${new Date(h.date).toLocaleDateString('en-IN')}</td><td>${escapeHTML(h.type)}</td><td>${escapeHTML(h.mode||'—')}</td><td>${fmtINR(h.amount||0)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">No payments recorded yet.</td></tr>'}</tbody></table></div></div></div>`;document.body.appendChild(o);o.querySelector('.modal-close-btn').onclick=()=>o.remove();o.querySelector('[data-repay]')?.addEventListener('click',()=>{o.remove();repayLoan(id)});o.querySelector('[data-edit]').onclick=()=>{o.remove();editLoan(id)};o.onclick=e=>{if(e.target===o)o.remove();};
}
function editLoan(id) {
    const l=state.loans.find(x=>x.id===id);if(!l)return;showFormModal({title:`Edit ${l.name}`,icon:'fa-pen',submitLabel:'Save Changes',wide:true,fields:[{id:'name',label:'Client Name',required:true,value:l.name},{id:'phone',label:'Phone',required:true,value:l.phone||''},{id:'email',label:'Email',type:'email',value:l.email||''},{id:'guarantor',label:'Guarantor',value:l.guarantor||''},{id:'dueDate',label:'Due Date',type:'date',value:l.dueDate||''}],onSubmit:v=>{l.name=v.name||l.name;l.phone=v.phone||l.phone;l.email=v.email;l.guarantor=v.guarantor;l.dueDate=v.dueDate||l.dueDate;saveState();renderAll();showToast('Loan updated.','success');}});
}
function deleteLoan(id) {
    if(!confirm('Move this loan to the recycle bin?'))return;const i=state.loans.findIndex(l=>l.id===id);if(i<0)return;state.loanTrash=state.loanTrash||[];state.loanTrash.unshift({...state.loans[i],deletedAt:Date.now()});state.loans.splice(i,1);saveState();renderAll();showToast('Loan moved to recycle bin.','warning');
}
function showLoanTrash() {
    const o=document.createElement('div');o.className='modal-overlay modal-wide';state.loanTrash=state.loanTrash||[];o.innerHTML=`<div class="modal-card"><div class="modal-header"><h3>Recycle Bin</h3><button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button></div><div class="table-responsive"><table><thead><tr><th>Client</th><th>Amount</th><th>Deleted</th><th>Action</th></tr></thead><tbody>${state.loanTrash.length?state.loanTrash.map(l=>`<tr><td>${escapeHTML(l.name)}</td><td>${fmtINR(l.amount)}</td><td>${new Date(l.deletedAt).toLocaleString('en-IN')}</td><td><button class="row-action-btn" data-restore="${l.id}"><i class="fa-solid fa-rotate-left"></i></button></td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">Recycle bin is empty.</td></tr>'}</tbody></table></div></div>`;document.body.appendChild(o);o.querySelector('.modal-close-btn').onclick=()=>o.remove();o.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{const i=state.loanTrash.findIndex(l=>l.id===b.dataset.restore);if(i>=0){const [l]=state.loanTrash.splice(i,1);delete l.deletedAt;state.loans.push(l);saveState();renderAll();o.remove();showToast('Loan restored.','success');}});
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
