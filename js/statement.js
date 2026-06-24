/* ============================================================
   statement.js — Full Loan Account Statement Generator
   One-click download of a complete, printable loan statement
   including all transactions, notes, interest entries & summary.

   Dependencies: state, agentState, fmtINR, escapeHTML (global)
   ============================================================ */

function downloadStatement(loanId) {
    const loan = state.loans.find(x => x.id === loanId);
    if (!loan) return;
    if (typeof normaliseLoan === 'function') normaliseLoan(loan);

    /* ── Agent info ── */
    const agent      = loan.agentId ? agentState.find(a => a.id === loan.agentId) : null;
    const agentName  = agent ? (agent.kyc?.name || agent.name || '—') : (state.user?.name || '—');
    const agentIdStr = agent ? ('AGT-' + String(agent.id).slice(-8).toUpperCase()) : '—';
    const agentPhone = agent?.kyc?.mobile || agent?.phone || '—';
    const signature  = agent?.kycDocs?.signature || null;

    /* ── Loan summary numbers ── */
    const totalPrincipalPaid  = loan.principalPaidTotal  || 0;
    const totalInterestPaid   = loan.interestPaidTotal   || 0;
    const totalPaid           = totalPrincipalPaid + totalInterestPaid;
    const outstandingPrincipal = loan.principalOutstanding || 0;
    const outstandingInterest  = loan.interestOutstanding  || 0;
    const totalOutstanding     = outstandingPrincipal + outstandingInterest;
    const isPaidOff            = loan.status === 'Paid';

    /* ── Dates ── */
    const generatedOn = new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const sanctionDateStr = loan.sanctionDate
        ? new Date(loan.sanctionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
        : '—';
    const dueDateStr = loan.dueDate || '—';

    /* ── Statement ID ── */
    const stmtId = 'STMT-' + Date.now().toString(36).toUpperCase();

    /* ── Interest entries rows ── */
    const interestRows = (loan.interestEntries || []).length
        ? loan.interestEntries.map((e, i) => `
            <tr class="${e.paid ? '' : 'stmt-row-pending'}">
                <td>${i + 1}</td>
                <td>${new Date(e.cycleDue).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td>${fmtINR(e.amount)}</td>
                <td>${fmtINR(e.paidAmount || 0)}</td>
                <td><span class="stmt-pill ${e.paid ? 'stmt-pill-paid' : 'stmt-pill-pending'}">${e.paid ? 'Paid' : 'Pending'}</span></td>
            </tr>`).join('')
        : `<tr><td colspan="5" class="stmt-empty">No interest entries recorded.</td></tr>`;

    /* ── Transaction history rows ── */
    const historyRows = (loan.history || []).length
        ? [...loan.history].reverse().map((h, i) => {
            const isPayment = h.type === 'Interest Payment' || h.type === 'Principal Payment';
            const dateObj   = h.date ? new Date(h.date) : null;
            const dateStr   = dateObj
                ? dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';
            const timeStr   = dateObj
                ? dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : '';
            const rcptId    = h.receiptId || '—';
            const noteText  = h.note ? escapeHTML(h.note) : '—';
            return `
            <tr class="${isPayment ? 'stmt-row-payment' : ''}">
                <td class="stmt-td-num">${i + 1}</td>
                <td>
                    <span class="stmt-date">${dateStr}</span>
                    ${timeStr ? `<span class="stmt-time">${timeStr}</span>` : ''}
                </td>
                <td><span class="stmt-entry-type ${isPayment ? 'stmt-type-payment' : 'stmt-type-other'}">${escapeHTML(h.type || '—')}</span></td>
                <td>${escapeHTML(h.mode || '—')}</td>
                <td class="stmt-td-amt ${isPayment ? 'stmt-amt-credit' : ''}">${fmtINR(h.amount || 0)}</td>
                <td class="stmt-td-rcpt">${rcptId !== '—' ? `<span class="stmt-rcpt-id">${rcptId}</span>` : '—'}</td>
                <td class="stmt-td-note">${noteText}</td>
            </tr>`;
        }).join('')
        : `<tr><td colspan="7" class="stmt-empty">No transactions recorded.</td></tr>`;

    /* ── Signature block ── */
    const sigBlock = signature
        ? `<img src="${signature}" class="stmt-sig-img" alt="Agent Signature">`
        : `<div class="stmt-sig-blank"></div>`;

    /* ── Full HTML ── */
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statement — ${escapeHTML(loan.name)} — ${stmtId}</title>
<style>
${statementCSS()}
</style>
</head>
<body>

<!-- ══ HEADER ══ -->
<div class="stmt-header">
    <div class="stmt-brand">
        <div class="stmt-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="rgba(255,255,255,0.2)"/>
                <path d="M5 8h14M5 12h9M5 16h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </div>
        <div>
            <div class="stmt-company">Pocket Finance</div>
            <div class="stmt-company-sub">Loan Management Services</div>
        </div>
    </div>
    <div class="stmt-title-block">
        <div class="stmt-title">LOAN ACCOUNT STATEMENT</div>
        <div class="stmt-stmt-id">${stmtId}</div>
        <div class="stmt-generated">Generated: ${generatedOn}</div>
    </div>
</div>
<div class="stmt-header-rule"></div>

<!-- ══ CLIENT + AGENT INFO ══ -->
<div class="stmt-info-grid">
    <div class="stmt-info-section">
        <div class="stmt-section-label">CLIENT INFORMATION</div>
        <div class="stmt-info-row"><span>Name</span><strong>${escapeHTML(loan.name || '—')}</strong></div>
        <div class="stmt-info-row"><span>Phone</span><strong>${escapeHTML(loan.phone || '—')}</strong></div>
        <div class="stmt-info-row"><span>Email</span><strong>${escapeHTML(loan.email || '—')}</strong></div>
        <div class="stmt-info-row"><span>Guarantor</span><strong>${escapeHTML(loan.guarantor || '—')}</strong></div>
    </div>
    <div class="stmt-info-section">
        <div class="stmt-section-label">LOAN DETAILS</div>
        <div class="stmt-info-row"><span>Principal Amount</span><strong>${fmtINR(loan.amount)}</strong></div>
        <div class="stmt-info-row"><span>Interest Rate</span><strong>${loan.rate || 0}% / ${loan.payType || 'Monthly'}</strong></div>
        <div class="stmt-info-row"><span>Payment Plan</span><strong>${loan.payType || '—'} · ${loan.tenure || '—'} payments</strong></div>
        <div class="stmt-info-row"><span>Sanction Date</span><strong>${sanctionDateStr}</strong></div>
        <div class="stmt-info-row"><span>Due Date</span><strong>${dueDateStr}</strong></div>
        <div class="stmt-info-row"><span>Status</span><strong class="${isPaidOff ? 'stmt-status-paid' : 'stmt-status-active'}">${isPaidOff ? '✓ Closed' : loan.status || 'Active'}</strong></div>
    </div>
    <div class="stmt-info-section">
        <div class="stmt-section-label">AGENT INFORMATION</div>
        <div class="stmt-info-row"><span>Agent Name</span><strong>${escapeHTML(agentName)}</strong></div>
        <div class="stmt-info-row"><span>Agent ID</span><strong>${escapeHTML(agentIdStr)}</strong></div>
        <div class="stmt-info-row"><span>Agent Phone</span><strong>${escapeHTML(agentPhone)}</strong></div>
    </div>
</div>

<!-- ══ SUMMARY CARDS ══ -->
<div class="stmt-summary-grid">
    <div class="stmt-summary-card stmt-card-blue">
        <div class="stmt-summary-label">Original Principal</div>
        <div class="stmt-summary-val">${fmtINR(loan.amount)}</div>
    </div>
    <div class="stmt-summary-card stmt-card-green">
        <div class="stmt-summary-label">Principal Paid</div>
        <div class="stmt-summary-val">${fmtINR(totalPrincipalPaid)}</div>
    </div>
    <div class="stmt-summary-card stmt-card-green">
        <div class="stmt-summary-label">Interest Paid</div>
        <div class="stmt-summary-val">${fmtINR(totalInterestPaid)}</div>
    </div>
    <div class="stmt-summary-card stmt-card-green">
        <div class="stmt-summary-label">Total Paid</div>
        <div class="stmt-summary-val">${fmtINR(totalPaid)}</div>
    </div>
    <div class="stmt-summary-card ${outstandingPrincipal > 0 ? 'stmt-card-red' : 'stmt-card-green'}">
        <div class="stmt-summary-label">Principal Outstanding</div>
        <div class="stmt-summary-val">${fmtINR(outstandingPrincipal)}</div>
    </div>
    <div class="stmt-summary-card ${outstandingInterest > 0 ? 'stmt-card-orange' : 'stmt-card-green'}">
        <div class="stmt-summary-label">Interest Outstanding</div>
        <div class="stmt-summary-val">${fmtINR(outstandingInterest)}</div>
    </div>
    <div class="stmt-summary-card ${totalOutstanding > 0 ? 'stmt-card-red' : 'stmt-card-green'} stmt-card-wide">
        <div class="stmt-summary-label">Total Outstanding</div>
        <div class="stmt-summary-val stmt-val-large">${isPaidOff ? '✓ FULLY PAID' : fmtINR(totalOutstanding)}</div>
    </div>
</div>

<!-- ══ INTEREST SCHEDULE ══ -->
<div class="stmt-section-title">Interest Schedule</div>
<div class="stmt-table-wrap">
<table class="stmt-table">
    <thead>
        <tr>
            <th>#</th>
            <th>Cycle Due Date</th>
            <th>Amount Due</th>
            <th>Amount Paid</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody>
        ${interestRows}
    </tbody>
</table>
</div>

<!-- ══ TRANSACTION HISTORY ══ -->
<div class="stmt-section-title" style="margin-top:28px;">Complete Transaction History</div>
<div class="stmt-table-wrap">
<table class="stmt-table stmt-table-history">
    <thead>
        <tr>
            <th>#</th>
            <th>Date & Time</th>
            <th>Transaction Type</th>
            <th>Mode</th>
            <th>Amount</th>
            <th>Receipt No.</th>
            <th>Note</th>
        </tr>
    </thead>
    <tbody>
        ${historyRows}
    </tbody>
    <tfoot>
        <tr class="stmt-tfoot-row">
            <td colspan="4"><strong>Total Received (Payments Only)</strong></td>
            <td class="stmt-amt-credit"><strong>${fmtINR(totalPaid)}</strong></td>
            <td colspan="2"></td>
        </tr>
    </tfoot>
</table>
</div>

<!-- ══ FOOTER / SIGNATURE ══ -->
<div class="stmt-footer">
    <div class="stmt-sig-block">
        ${sigBlock}
        <div class="stmt-sig-label">Authorised Signature — ${escapeHTML(agentName)}</div>
    </div>
    <div class="stmt-footer-text">
        <p>This is a system-generated statement and does not require a physical stamp unless a signature is present above.</p>
        <p><strong>Pocket Finance</strong> · ${stmtId} · Generated on ${generatedOn}</p>
    </div>
</div>

</body>
</html>`;

    /* ── Open in new window and print/save ── */
    const win = window.open('', '_blank', 'width=1000,height=900');
    if (!win) { showToast('Allow pop-ups to download the statement.', 'warning'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 1000);
}

/* ── Statement CSS ─────────────────────────────────────────── */
function statementCSS() {
    return `
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    color: #1a1a1a;
    background: #fff;
    padding: 32px 40px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

/* ── Header ── */
.stmt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    background: linear-gradient(135deg, #f97316, #ea580c);
    border-radius: 12px 12px 0 0;
    color: #fff;
}
.stmt-brand { display: flex; align-items: center; gap: 14px; }
.stmt-logo {
    width: 48px; height: 48px;
    background: rgba(255,255,255,.18);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
}
.stmt-company { font-size: 22px; font-weight: 800; letter-spacing: 0.3px; }
.stmt-company-sub { font-size: 12px; opacity: 0.85; margin-top: 2px; }
.stmt-title-block { text-align: right; }
.stmt-title { font-size: 13px; font-weight: 800; letter-spacing: 2px; opacity: 0.9; }
.stmt-stmt-id { font-size: 18px; font-weight: 800; margin: 3px 0; }
.stmt-generated { font-size: 11px; opacity: 0.8; }
.stmt-header-rule {
    height: 4px;
    background: linear-gradient(90deg, #f97316, #fb923c, #fed7aa, transparent);
    margin-bottom: 24px;
}

/* ── Info grid ── */
.stmt-info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
}
.stmt-info-section {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    background: #fafafa;
}
.stmt-section-label {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 1.8px;
    color: #f97316;
    margin-bottom: 10px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
}
.stmt-info-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 3px 0;
    font-size: 12px;
    border-bottom: 1px dashed #f0f0f0;
}
.stmt-info-row:last-child { border: none; }
.stmt-info-row span { color: #6b7280; white-space: nowrap; }
.stmt-info-row strong { text-align: right; color: #111; word-break: break-word; }
.stmt-status-paid { color: #16a34a !important; }
.stmt-status-active { color: #f97316 !important; }

/* ── Summary cards ── */
.stmt-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 28px;
}
.stmt-summary-card {
    border-radius: 10px;
    padding: 12px 14px;
    border-left: 4px solid;
}
.stmt-card-wide { grid-column: span 4; }
.stmt-card-blue  { background: #eff6ff; border-color: #3b82f6; }
.stmt-card-green { background: #f0fdf4; border-color: #22c55e; }
.stmt-card-red   { background: #fef2f2; border-color: #ef4444; }
.stmt-card-orange{ background: #fff7ed; border-color: #f97316; }
.stmt-summary-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: #6b7280;
    margin-bottom: 5px;
    text-transform: uppercase;
}
.stmt-summary-val {
    font-size: 18px;
    font-weight: 800;
    color: #111;
}
.stmt-val-large { font-size: 22px; }

/* ── Section titles ── */
.stmt-section-title {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #374151;
    border-left: 4px solid #f97316;
    padding: 4px 0 4px 12px;
    margin-bottom: 12px;
}

/* ── Tables ── */
.stmt-table-wrap {
    overflow: visible;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
}
.stmt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}
.stmt-table thead tr {
    background: #1f2937;
    color: #fff;
}
.stmt-table thead th {
    padding: 10px 12px;
    text-align: left;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.5px;
    white-space: nowrap;
}
.stmt-table tbody tr { border-bottom: 1px solid #f3f4f6; }
.stmt-table tbody tr:last-child { border-bottom: none; }
.stmt-table tbody tr:nth-child(even) { background: #f9fafb; }
.stmt-table tbody td { padding: 9px 12px; vertical-align: top; }

/* Interest table specific */
.stmt-row-pending { background: #fff8f0 !important; }
.stmt-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
}
.stmt-pill-paid { background: #dcfce7; color: #15803d; }
.stmt-pill-pending { background: #fff0e0; color: #c2410c; }

/* History table specific */
.stmt-table-history th:nth-child(7),
.stmt-table-history td:nth-child(7) { min-width: 140px; }
.stmt-row-payment { background: #f0fdf4 !important; }
.stmt-date { display: block; font-weight: 600; color: #111; }
.stmt-time { display: block; font-size: 11px; color: #9ca3af; margin-top: 1px; }
.stmt-entry-type {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
}
.stmt-type-payment { background: #dcfce7; color: #15803d; }
.stmt-type-other   { background: #f3f4f6; color: #374151; }
.stmt-td-num { color: #9ca3af; width: 32px; text-align: center; }
.stmt-td-amt { text-align: right; font-weight: 700; white-space: nowrap; }
.stmt-amt-credit { color: #16a34a !important; }
.stmt-td-rcpt { font-size: 11px; font-family: monospace; color: #6b7280; }
.stmt-rcpt-id {
    background: #f3f4f6;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
}
.stmt-td-note {
    font-size: 11px;
    color: #374151;
    max-width: 160px;
    word-break: break-word;
    font-style: italic;
}
.stmt-empty { text-align: center; color: #9ca3af; padding: 20px; font-style: italic; }

/* Table footer */
.stmt-tfoot-row { background: #1f2937 !important; color: #fff; }
.stmt-tfoot-row td { padding: 10px 12px; font-size: 13px; }
.stmt-tfoot-row .stmt-amt-credit { color: #86efac !important; font-size: 15px; }

/* ── Footer / Signature ── */
.stmt-footer {
    margin-top: 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
    border-top: 2px solid #e5e7eb;
    padding-top: 20px;
}
.stmt-sig-block { display: flex; flex-direction: column; gap: 6px; }
.stmt-sig-img {
    max-height: 70px;
    max-width: 200px;
    object-fit: contain;
    border-bottom: 1.5px solid #9ca3af;
    padding-bottom: 6px;
}
.stmt-sig-blank {
    width: 200px;
    height: 60px;
    border-bottom: 1.5px solid #9ca3af;
}
.stmt-sig-label { font-size: 10px; color: #9ca3af; letter-spacing: 0.5px; }
.stmt-footer-text { text-align: right; font-size: 11px; color: #9ca3af; line-height: 1.7; }
.stmt-footer-text strong { color: #374151; }

/* ── Print ── */
@media print {
    body { padding: 16px 20px; }
    .stmt-header { border-radius: 6px 6px 0 0; }
    .stmt-summary-grid { grid-template-columns: repeat(4, 1fr); }
}
`;
}
