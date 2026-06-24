/* ============================================================
   receipt.js — Payment Receipt Generator  v2
   ============================================================
   Changes in v2:
   - Print window uses -webkit-print-color-adjust + color-adjust
     so the orange header prints correctly (not grey)
   - Share button opens WhatsApp directly on mobile; falls back
     to clipboard on desktop
   - receiptId is stored on the history entry so agents can
     re-download any past receipt from viewLoan
   - downloadReceipt(loan, historyEntry) — called from viewLoan
     payment history row for anytime download
   ============================================================ */

/* ── helpers ───────────────────────────────────────────────── */

function rcptAgentInfo(agentId) {
    const agent = agentId ? agentState.find(a => a.id === agentId) : null;
    return {
        agent,
        agentName  : agent ? (agent.kyc?.name || agent.name || 'Agent') : (state.user?.name || 'Agent'),
        agentIdStr : agent ? ('AGT-' + String(agent.id).slice(-8).toUpperCase()) : '—',
        signature  : agent?.kycDocs?.signature || null,
    };
}

function rcptDateStr(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function rcptTimeStr(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/* ── core receipt HTML builder ─────────────────────────────── */

function buildReceiptHTML(loan, paymentAmount, paymentType, paymentMode, invoiceNo, ts) {
    const { agentName, agentIdStr, signature } = rcptAgentInfo(loan.agentId);
    const dateStr = rcptDateStr(ts);
    const timeStr = rcptTimeStr(ts);

    const outstandingPrincipal = loan.principalOutstanding || 0;
    const outstandingInterest  = loan.interestOutstanding  || 0;
    const totalOutstanding     = outstandingPrincipal + outstandingInterest;
    const isPaidOff            = loan.status === 'Paid';

    const sigBlock = signature
        ? `<div class="rcpt-sig-wrap">
               <img src="${signature}" class="rcpt-sig-img" alt="Agent Signature">
               <div class="rcpt-sig-label">Authorised Signature</div>
           </div>`
        : `<div class="rcpt-sig-wrap rcpt-sig-blank">
               <div class="rcpt-sig-line"></div>
               <div class="rcpt-sig-label">Authorised Signature</div>
           </div>`;

    return `
<div class="rcpt-card" id="pf-receipt-print">
  <div class="rcpt-header">
    <div class="rcpt-brand">
      <div class="rcpt-logo-mark"><i class="fa-solid fa-wallet"></i></div>
      <div>
        <div class="rcpt-company">Pocket Finance</div>
        <div class="rcpt-company-sub">Loan Management Services</div>
      </div>
    </div>
    <div class="rcpt-invoice-meta">
      <div class="rcpt-invoice-label">INVOICE</div>
      <div class="rcpt-invoice-no">${escapeHTML(invoiceNo)}</div>
      <div class="rcpt-invoice-date">${dateStr} · ${timeStr}</div>
    </div>
  </div>

  <div class="rcpt-rule"></div>

  <div class="rcpt-parties">
    <div class="rcpt-party">
      <div class="rcpt-party-label">FROM (Agent)</div>
      <div class="rcpt-party-name">${escapeHTML(agentName)}</div>
      <div class="rcpt-party-sub">${escapeHTML(agentIdStr)}</div>
    </div>
    <div class="rcpt-party rcpt-party-right">
      <div class="rcpt-party-label">TO (Client)</div>
      <div class="rcpt-party-name">${escapeHTML(loan.name || '—')}</div>
      <div class="rcpt-party-sub">${escapeHTML(loan.phone || 'No phone')}</div>
    </div>
  </div>

  <div class="rcpt-summary-box">
    <div class="rcpt-summary-row rcpt-summary-main">
      <span>Amount Received</span>
      <span class="rcpt-amount-paid">${fmtINR(paymentAmount)}</span>
    </div>
    <div class="rcpt-summary-row">
      <span>Payment Type</span>
      <span>${escapeHTML(paymentType)}</span>
    </div>
    <div class="rcpt-summary-row">
      <span>Mode</span>
      <span>${escapeHTML(paymentMode || '—')}</span>
    </div>
  </div>

  <div class="rcpt-balance-grid">
    <div class="rcpt-balance-item">
      <div class="rcpt-balance-label">Original Principal</div>
      <div class="rcpt-balance-val">${fmtINR(loan.amount)}</div>
    </div>
    <div class="rcpt-balance-item">
      <div class="rcpt-balance-label">Principal Outstanding</div>
      <div class="rcpt-balance-val ${outstandingPrincipal > 0 ? 'rcpt-val-pending' : 'rcpt-val-clear'}">${fmtINR(outstandingPrincipal)}</div>
    </div>
    <div class="rcpt-balance-item">
      <div class="rcpt-balance-label">Interest Outstanding</div>
      <div class="rcpt-balance-val ${outstandingInterest > 0 ? 'rcpt-val-pending' : 'rcpt-val-clear'}">${fmtINR(outstandingInterest)}</div>
    </div>
    <div class="rcpt-balance-item">
      <div class="rcpt-balance-label">Total Outstanding</div>
      <div class="rcpt-balance-val ${totalOutstanding > 0 ? 'rcpt-val-pending' : 'rcpt-val-clear'}">
        ${isPaidOff ? '<span class="rcpt-paid-badge">LOAN CLOSED ✓</span>' : fmtINR(totalOutstanding)}
      </div>
    </div>
  </div>

  <div class="rcpt-footer-row">
    ${sigBlock}
    <div class="rcpt-stamp ${isPaidOff ? 'rcpt-stamp-paid' : 'rcpt-stamp-partial'}">
      ${isPaidOff ? 'PAID IN FULL' : 'PAYMENT<br>RECEIVED'}
    </div>
  </div>

  <div class="rcpt-policy-note">
    ${loan.payType === 'Daily'
      ? `<span class="rcpt-policy-icon">⚠️</span><span><strong>Note:</strong> If the payment is not made on the due date, a grace period of a few days will be given but a <strong>30% penalty will be charged.</strong></span>`
      : loan.payType === 'Weekly'
      ? `<span class="rcpt-policy-icon">⚠️</span><span><strong>Note:</strong> If even one day of the week is skipped, then the full week amount will have to be given.</span>`
      : `<span class="rcpt-policy-icon">⚠️</span><span><strong>Note:</strong> If even one day of the month is skipped, then the <strong>full month will have to be given.</strong></span>`
    }
  </div>

  <div class="rcpt-legal">
    This is a computer-generated receipt and is valid without a physical signature unless a wet signature is
    displayed above. Pocket Finance · <em>Authorised by ${escapeHTML(agentName)}</em>
  </div>
</div>`;
}

/* ── print CSS — color-adjust flags ensure orange header prints ─ */

function receiptPrintCSS() {
    return `
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body {
  background: #f4f4f4;
  display: flex; justify-content: center; padding: 30px;
  font-family: 'Segoe UI', Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  color-adjust: exact;
}
.rcpt-card {
  background:#fff; width:100%; max-width:580px;
  border-radius:12px; overflow:hidden;
  box-shadow:0 4px 24px rgba(0,0,0,.12);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.rcpt-header {
  display:flex; justify-content:space-between; align-items:center;
  padding:22px 24px;
  background:#f97316 !important;
  background: linear-gradient(135deg,#f97316,#ea580c) !important;
  color:#fff !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.rcpt-brand { display:flex; align-items:center; gap:14px; }
.rcpt-logo-mark {
  width:44px; height:44px; background:rgba(255,255,255,.2) !important;
  border-radius:10px; display:flex; align-items:center;
  justify-content:center; font-size:22px; color:#fff;
}
.rcpt-company { font-size:20px; font-weight:800; letter-spacing:.5px; color:#fff; }
.rcpt-company-sub { font-size:11px; opacity:.85; margin-top:2px; color:#fff; }
.rcpt-invoice-meta { text-align:right; color:#fff; }
.rcpt-invoice-label { font-size:10px; letter-spacing:2px; opacity:.8; }
.rcpt-invoice-no { font-size:16px; font-weight:700; margin:2px 0; }
.rcpt-invoice-date { font-size:11px; opacity:.85; }
.rcpt-rule {
  height:3px;
  background: linear-gradient(90deg,#f97316,#fb923c,transparent) !important;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-parties { display:flex; justify-content:space-between; padding:18px 24px 10px; gap:16px; }
.rcpt-party-label { font-size:10px; letter-spacing:1.5px; color:#9ca3af; font-weight:600; margin-bottom:4px; }
.rcpt-party-name { font-size:15px; font-weight:700; color:#111; }
.rcpt-party-sub { font-size:12px; color:#6b7280; margin-top:2px; }
.rcpt-party-right { text-align:right; }
.rcpt-summary-box {
  margin:8px 24px 0;
  background:#fff7ed !important; border:1.5px solid #fed7aa; border-radius:10px; padding:14px 18px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-summary-row { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#374151; padding:4px 0; }
.rcpt-summary-row + .rcpt-summary-row { border-top:1px dashed #fde8cc; }
.rcpt-summary-main { font-weight:700; font-size:15px; padding-bottom:8px; margin-bottom:4px; border-bottom:2px solid #fed7aa !important; }
.rcpt-amount-paid { color:#ea580c !important; font-size:22px; font-weight:800; }
.rcpt-balance-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:14px 24px; }
.rcpt-balance-item {
  background:#f9fafb !important; border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-balance-label { font-size:10px; color:#9ca3af; letter-spacing:.5px; margin-bottom:4px; }
.rcpt-balance-val { font-size:14px; font-weight:700; color:#111; }
.rcpt-val-pending { color:#dc2626 !important; }
.rcpt-val-clear { color:#16a34a !important; }
.rcpt-paid-badge {
  background:#dcfce7 !important; color:#15803d !important;
  padding:2px 8px; border-radius:20px; font-size:12px; font-weight:700;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-footer-row { display:flex; justify-content:space-between; align-items:flex-end; padding:14px 24px 10px; }
.rcpt-sig-wrap { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
.rcpt-sig-img { max-height:60px; max-width:160px; object-fit:contain; border-bottom:1.5px solid #d1d5db; padding-bottom:4px; }
.rcpt-sig-blank .rcpt-sig-line { width:160px; border-bottom:1.5px solid #9ca3af; height:50px; }
.rcpt-sig-label { font-size:10px; color:#9ca3af; letter-spacing:.5px; }
.rcpt-stamp {
  border:3px solid; border-radius:6px; padding:6px 14px;
  font-size:13px; font-weight:800; letter-spacing:2px;
  transform:rotate(-8deg); text-align:center; line-height:1.4;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-stamp-paid  { border-color:#16a34a !important; color:#16a34a !important; }
.rcpt-stamp-partial { border-color:#f97316 !important; color:#f97316 !important; }
.rcpt-policy-note {
  display:flex; align-items:flex-start; gap:8px;
  margin:0 24px 0; padding:11px 14px;
  background:#1a1a1a !important; border-left:4px solid #f97316 !important;
  border-radius:0 8px 8px 0; color:#f1f1f1 !important;
  font-size:12px; line-height:1.6; font-weight:500;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rcpt-policy-note strong { color:#fff !important; font-weight:800; }
.rcpt-policy-icon { font-size:14px; margin-top:1px; flex-shrink:0; }
.rcpt-legal {
  background:#f9fafb !important; border-top:1px solid #e5e7eb;
  padding:10px 24px; font-size:10px; color:#9ca3af; line-height:1.6;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
@media print {
  body { background:#fff !important; padding:10px; }
  .rcpt-card { box-shadow:none; border-radius:0; max-width:100%; }
}`;
}

/* ── WhatsApp / plain-text share string ────────────────────── */

function buildShareText(loan, paid, type, mode, invoiceNo, ts) {
    const { agentName, agentIdStr } = rcptAgentInfo(loan.agentId);
    const dateStr = rcptDateStr(ts);
    const timeStr = rcptTimeStr(ts);
    const outP = loan.principalOutstanding || 0;
    const outI = loan.interestOutstanding  || 0;
    const isPaid = loan.status === 'Paid';

    return [
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '🏦  *POCKET FINANCE*',
        '    Payment Receipt',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `📄 *Invoice:* ${invoiceNo}`,
        `📅 *Date:* ${dateStr}, ${timeStr}`,
        '',
        `👤 *Agent:* ${agentName} (${agentIdStr})`,
        `👥 *Client:* ${loan.name || '—'} · ${loan.phone || ''}`,
        '',
        `💰 *Amount Paid:* ${fmtINR(paid)}`,
        `📋 *Type:* ${type}`,
        `🏧 *Mode:* ${mode || '—'}`,
        '',
        '📊 *Loan Balance*',
        `   Original Principal   : ${fmtINR(loan.amount)}`,
        `   Principal Outstanding: ${fmtINR(outP)}`,
        `   Interest Outstanding : ${fmtINR(outI)}`,
        isPaid
            ? '   ✅ *LOAN FULLY CLOSED*'
            : `   Total Outstanding   : ${fmtINR(outP + outI)}`,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '_This is a system-generated receipt._',
        `_Pocket Finance — Authorised by ${agentName}_`,
    ].join('\n');
}

/* ── open print window ─────────────────────────────────────── */

function openPrintWindow(receiptHTML, invoiceNo) {
    const faLink = document.querySelector('link[href*="fontawesome"]')?.href
                || 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    const win = window.open('', '_blank', 'width=700,height=960');
    if (!win) { showToast('Allow pop-ups to print.', 'warning'); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt ${invoiceNo}</title>
  <link rel="stylesheet" href="${faLink}">
  <style>${receiptPrintCSS()}</style>
</head>
<body>${receiptHTML}</body>
</html>`);
    win.document.close();
    // Give FA icons 1.2s to load before printing
    setTimeout(() => { win.focus(); win.print(); }, 1200);
}

/* ── share / WhatsApp ──────────────────────────────────────── */

async function shareReceipt(loan, paid, type, mode, invoiceNo, ts) {
    const text = buildShareText(loan, paid, type, mode, invoiceNo, ts);

    // Try native share first (mobile)
    if (navigator.share) {
        try { await navigator.share({ title: `Receipt ${invoiceNo} — Pocket Finance`, text }); return; }
        catch (e) { /* user dismissed */ }
    }

    // WhatsApp direct link as primary fallback
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
    const opened = window.open(waUrl, '_blank');
    if (!opened) {
        // last resort: clipboard
        try {
            await navigator.clipboard.writeText(text);
            showToast('Receipt copied to clipboard!', 'success');
        } catch {
            showToast('Could not open WhatsApp. Copy manually.', 'warning');
        }
    }
}

/* ── main modal ────────────────────────────────────────────── */

function showReceiptModal(loan, paymentAmount, paymentType, paymentMode, invoiceNo, ts) {
    invoiceNo = invoiceNo || ('PF-' + Date.now().toString(36).toUpperCase());
    ts        = ts        || Date.now();

    const receiptHTML = buildReceiptHTML(loan, paymentAmount, paymentType, paymentMode, invoiceNo, ts);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-wide';
    overlay.innerHTML = `
<div class="modal-card" style="max-width:600px;">
  <div class="modal-header">
    <div class="modal-icon"><i class="fa-solid fa-file-invoice"></i></div>
    <div class="loan-profile-heading">
      <h3>Payment Receipt</h3>
      <small>${escapeHTML(loan.name || '—')} · ${escapeHTML(invoiceNo)}</small>
    </div>
    <button class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="modal-body" style="padding:0 20px 20px;">
    ${receiptHTML}
    <div class="rcpt-action-row">
      <button class="btn-friendly-primary" id="rcpt-btn-print">
        <i class="fa-solid fa-download"></i> Download / Print
      </button>
      <button class="btn-friendly-secondary rcpt-btn-whatsapp" id="rcpt-btn-share">
        <i class="fa-brands fa-whatsapp"></i> WhatsApp
      </button>
    </div>
  </div>
</div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close-btn').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelector('#rcpt-btn-print').onclick = () =>
        openPrintWindow(receiptHTML, invoiceNo);

    overlay.querySelector('#rcpt-btn-share').onclick = () =>
        shareReceipt(loan, paymentAmount, paymentType, paymentMode, invoiceNo, ts);
}

/* ── download from history entry (anytime) ─────────────────── */

/**
 * Called from the receipt icon button in viewLoan payment history.
 * Reconstructs the receipt from the saved history entry.
 * Note: balance figures shown are current (live), not historical snapshot,
 * since we don't snapshot balances per-payment. Invoice # and date are exact.
 */
function downloadReceiptFromHistory(loanId, histIdx) {
    const loan = state.loans.find(x => x.id === loanId);
    if (!loan) return;
    if (typeof normaliseLoan === 'function') normaliseLoan(loan);
    const h = loan.history[histIdx];
    if (!h) return;

    const invoiceNo = h.receiptId || ('PF-' + (h.date || Date.now()).toString(16).toUpperCase());
    showReceiptModal(loan, h.amount || 0, h.type || 'Payment', h.mode || '—', invoiceNo, h.date || Date.now());
}

/* ── offerReceipt — called from wallet.js after repayLoan ──── */

function offerReceipt(loan, amount, type, mode, receiptId, ts) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = 'toast success';
    el.innerHTML = `
      <i class="fa-solid fa-circle-check"></i>
      <span style="flex:1;">Payment recorded.</span>
      <button class="rcpt-toast-btn" style="
        margin-left:8px; padding:3px 12px; border:none;
        background:rgba(255,255,255,0.25); color:inherit;
        border-radius:20px; font-size:12px; cursor:pointer;
        white-space:nowrap; font-weight:700; flex-shrink:0;">
        📄 Receipt
      </button>`;
    stack.appendChild(el);

    el.querySelector('.rcpt-toast-btn').onclick = () => {
        el.remove();
        showReceiptModal(loan, amount, type, mode, receiptId, ts);
    };

    setTimeout(() => {
        el.style.transition = 'opacity .3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 7000);
}
