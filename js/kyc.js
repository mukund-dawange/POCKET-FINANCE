/* ============================================================
   kyc.js — My Profile & KYC (agent) + KYC Approvals (admin/dev)
   ------------------------------------------------------------
   Storage: each agent record in `agentState` gets two new
   optional fields —
     agent.kyc      { name, dob, gender, mobile, email, address,
                       city, state, bankAcc, ifsc, qualType,
                       status: 'not_submitted'|'pending'|'approved'|'rejected',
                       rejectReason, submittedAt, reviewedAt, reviewedBy }
     agent.kycDocs  { photo, aadhar, pan, signature, marksheet10,
                       marksheet12, qr }   — each a compressed JPEG data URL

   Both ride on the existing shared saveState()/agentState sync —
   no new backend wiring. Documents are compressed client-side
   (reused resizeImageToDataURL-style approach, just larger/
   non-square) to keep the shared JSON payload reasonable, since
   it's polled by every logged-in user on the auto-sync interval.

   Fund allocation is NOT blocked by approval status — per design,
   admin can still allocate funds anytime; this page only shows a
   non-blocking status banner and feeds the approvals queue.
   ============================================================ */

const KYC_DOC_DEFS = [
    { key: 'aadhar', icon: '🪪', title: 'Aadhar Card', sub: 'Front & back · JPG/PNG/PDF · max 5MB', group: 'identity' },
    { key: 'pan', icon: '💳', title: 'PAN Card', sub: 'Clear photo · JPG/PNG/PDF · max 5MB', group: 'identity' },
    { key: 'signature', icon: '✍️', title: 'Signature', sub: 'On white paper, scanned/photo · JPG/PNG', group: 'identity' },
    { key: 'marksheet10', icon: '📗', title: '10th Marksheet', sub: 'SSC / Matric board certificate · JPG/PNG/PDF', group: 'qual10' },
    { key: 'marksheet12', icon: '📘', title: '12th Marksheet', sub: 'HSC / Intermediate board certificate · JPG/PNG/PDF', group: 'qual12' },
    { key: 'photo', icon: '🖼️', title: 'Passport Size Photo', sub: 'White background, recent · JPG/PNG · max 1MB', group: 'identity' },
    { key: 'qr', icon: '📱', title: 'Payment QR Code', sub: 'UPI / bank QR for receiving payouts · JPG/PNG', group: 'qr' }
];
// "Required" set always counts photo + aadhar + pan + signature + qr + ONE of the two marksheets (6 total)
function kycRequiredDocs(agent) {
    const qualType = agent?.kyc?.qualType === '12th' ? 'marksheet12' : 'marksheet10';
    return ['aadhar', 'pan', 'signature', 'photo', 'qr', qualType];
}

let kycActiveQualTab = '10th';
let kycSelectedAgentId = null; // for the admin approvals view

/* ---------------- shared helpers ---------------- */

function kycMyAgent() {
    if (state.user?.role !== 'agent') return null;
    return agentState.find(a => a.id === state.user.agentId) || null;
}

function kycEnsureShape(agent) {
    if (!agent.kyc) agent.kyc = { status: 'not_submitted' };
    if (!agent.kyc.status) agent.kyc.status = 'not_submitted';
    if (!agent.kycDocs) agent.kycDocs = {};
    return agent;
}

function kycUploadedCount(agent) {
    const req = kycRequiredDocs(agent);
    return req.filter(k => agent.kycDocs && agent.kycDocs[k]).length;
}

// Compress an uploaded document image client-side before it goes into shared state.
// PDFs are passed through as-is (can't rasterize without a library) but size-capped.
function kycCompressFile(file, maxW = 900, maxH = 900, quality = 0.72) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('No file selected.'));
        if (file.type === 'application/pdf') {
            if (file.size > 5 * 1024 * 1024) return reject(new Error('PDF is too large (max 5MB).'));
            const reader = new FileReader();
            reader.onload = () => resolve({ dataUrl: reader.result, isPdf: true });
            reader.onerror = () => reject(new Error('Could not read that file.'));
            reader.readAsDataURL(file);
            return;
        }
        if (!file.type || !file.type.startsWith('image/')) return reject(new Error('Please choose an image or PDF file.'));
        if (file.size > 10 * 1024 * 1024) return reject(new Error('File is too large (max 10MB).'));
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                const scale = Math.min(1, maxW / w, maxH / h);
                w = Math.round(w * scale); h = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), isPdf: false });
            };
            img.onerror = () => reject(new Error('Could not read that image.'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
    });
}

/* ============================================================
   AGENT SIDE — My Profile & KYC page
   ============================================================ */

function renderKycPage() {
    const me = kycMyAgent();
    if (!me) return; // admin/developer use the separate simple profile block in settings.js
    kycEnsureShape(me);

    renderKycStatusBanner(me);
    renderKycInfoForm(me);
    renderKycPhoto(me);
    renderKycDocLists(me);
    kycUpdateSubmitBar();
}

// Called on every renderAll() tick (e.g. the 20s autosync). Only touches things
// that are safe to refresh while the user might be mid-edit elsewhere on the
// page: the status banner and the uploaded-document badges/photo. It never
// rewrites the text inputs or re-builds the document rows, so typing or an
// in-progress upload is never interrupted or wiped.
function refreshKycPageLight() {
    const me = kycMyAgent();
    if (!me) return;
    kycEnsureShape(me);
    renderKycStatusBanner(me);
    const countEl = document.getElementById('kyc-doc-count');
    if (countEl) countEl.textContent = kycUploadedCount(me) + ' / 6 uploaded';
}

function renderKycStatusBanner(me) {
    const banner = document.getElementById('kyc-status-banner');
    const icon = document.getElementById('kyc-status-icon');
    const title = document.getElementById('kyc-status-title');
    const sub = document.getElementById('kyc-status-sub');
    const pill = document.getElementById('kyc-status-pill');
    const rejBox = document.getElementById('kyc-rejection-box');
    const rejReason = document.getElementById('kyc-rejection-reason');
    if (!banner) return;

    const status = me.kyc.status;
    banner.classList.remove('kyc-approved', 'kyc-rejected', 'kyc-verifying');
    rejBox.style.display = 'none';

    if (status === 'approved') {
        banner.classList.add('kyc-approved');
        icon.textContent = '✅';
        title.textContent = 'Account Verified';
        sub.textContent = 'Your KYC has been approved by the Hiring Authority. Your account is fully active.';
        pill.textContent = 'Approved';
    } else if (status === 'pending') {
        banner.classList.add('kyc-verifying');
        icon.textContent = '🔎';
        title.textContent = 'Submitted — Awaiting Review';
        sub.textContent = 'Your documents have been sent to the Hiring Authority. You will be notified once reviewed.';
        pill.textContent = 'Pending';
    } else if (status === 'rejected') {
        banner.classList.add('kyc-rejected');
        icon.textContent = '⚠️';
        title.textContent = 'Submission Rejected';
        sub.textContent = 'Please review the reason below, fix the issue and resubmit.';
        pill.textContent = 'Rejected';
        rejBox.style.display = 'block';
        rejReason.textContent = me.kyc.rejectReason || 'No reason provided.';
    } else {
        icon.textContent = '⏳';
        title.textContent = 'Account Verification Pending';
        sub.textContent = 'Submit your documents and basic info for Hiring Authority approval. Money will be allocated only after account is approved.';
        pill.textContent = 'Pending';
    }
}

function renderKycInfoForm(me) {
    const k = me.kyc;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('kyc-f-name', k.name || me.name);
    set('kyc-f-agentid', 'AGT-' + String(me.id).slice(-8).toUpperCase());
    set('kyc-f-dob', k.dob);
    set('kyc-f-gender', k.gender);
    set('kyc-f-mobile', k.mobile);
    set('kyc-f-email', k.email);
    set('kyc-f-address', k.address);
    set('kyc-f-city', k.city);
    set('kyc-f-state', k.state);
    set('kyc-f-bankacc', k.bankAcc);
    set('kyc-f-ifsc', k.ifsc);

    kycActiveQualTab = k.qualType === '12th' ? '12th' : '10th';
    document.getElementById('kyc-qual-tab-10')?.classList.toggle('active-tab', kycActiveQualTab === '10th');
    document.getElementById('kyc-qual-tab-12')?.classList.toggle('active-tab', kycActiveQualTab === '12th');
}

function renderKycPhoto(me) {
    const el = document.getElementById('kyc-photo-avatar');
    if (!el) return;
    const photo = me.kycDocs?.photo;
    el.innerHTML = photo ? `<img src="${photo}" alt="">` : escapeHTML(initials(me.kyc.name || me.name));
}

function renderKycDocLists(me) {
    const countEl = document.getElementById('kyc-doc-count');
    if (countEl) countEl.textContent = kycUploadedCount(me) + ' / 6 uploaded';

    const identityWrap = document.getElementById('kyc-doc-list-identity');
    const qualWrap = document.getElementById('kyc-doc-list-qual');
    const qrWrap = document.getElementById('kyc-doc-list-qr');
    if (!identityWrap) return;

    const renderRow = (def) => {
        const doc = me.kycDocs && me.kycDocs[def.key];
        const isPdf = doc && doc.startsWith('data:application/pdf');
        return `
        <div class="kyc-doc-row" data-ap-doc-row="${def.key}">
            ${doc
                ? (isPdf
                    ? `<div class="kyc-doc-icon" style="background:var(--danger-bg)">📄</div>`
                    : `<img class="kyc-doc-thumb" src="${doc}" alt="">`)
                : `<div class="kyc-doc-icon" style="background:var(--bg-secondary)">${def.icon}</div>`}
            <div class="kyc-doc-info">
                <div class="kyc-doc-title">${escapeHTML(def.title)} <span class="req">*</span></div>
                <div class="kyc-doc-sub">${escapeHTML(def.sub)}</div>
            </div>
            <span class="kyc-doc-status ${doc ? 'uploaded' : 'not-uploaded'}">${doc ? 'Uploaded' : 'Not Uploaded'}</span>
            <button type="button" class="kyc-doc-upload-btn" data-ap-doc-upload="${def.key}" title="${doc ? 'Replace' : 'Upload'}">
                <i class="fa-solid ${doc ? 'fa-rotate' : 'fa-arrow-up'}"></i>
            </button>
        </div>`;
    };

    identityWrap.innerHTML = KYC_DOC_DEFS.filter(d => d.group === 'identity').map(renderRow).join('');
    const qualDef = KYC_DOC_DEFS.find(d => d.group === (kycActiveQualTab === '12th' ? 'qual12' : 'qual10'));
    qualWrap.innerHTML = renderRow(qualDef);
    qrWrap.innerHTML = KYC_DOC_DEFS.filter(d => d.group === 'qr').map(renderRow).join('');

    document.querySelectorAll('[data-ap-doc-upload]').forEach(btn => {
        btn.addEventListener('click', () => kycTriggerDocUpload(btn.dataset.apDocUpload));
    });
}

let kycPendingUploadKey = null;
function kycTriggerDocUpload(key) {
    kycPendingUploadKey = key;
    document.getElementById('kyc-photo-file-input-hidden')?.click();
}

async function kycHandleDocFile(file) {
    const me = kycMyAgent();
    if (!me || !kycPendingUploadKey || !file) return;
    try {
        const { dataUrl } = await kycCompressFile(file);
        me.kycDocs = me.kycDocs || {};
        me.kycDocs[kycPendingUploadKey] = dataUrl;
        await saveState();
        renderKycPhoto(me);
        renderKycDocLists(me);
        kycUpdateSubmitBar();
        showToast('Document uploaded.', 'success');
    } catch (err) {
        showToast(err.message || 'Could not upload document.', 'danger');
    }
    kycPendingUploadKey = null;
}

// Saves whatever is currently in the text fields, no validation, no document
// requirement, and never changes kyc.status. Safe to call at any time.
function kycSaveDraft() {
    const me = kycMyAgent();
    if (!me) return false;
    kycEnsureShape(me);
    const k = me.kyc;
    k.name = document.getElementById('kyc-f-name').value.trim();
    k.dob = document.getElementById('kyc-f-dob').value;
    k.gender = document.getElementById('kyc-f-gender').value;
    k.mobile = document.getElementById('kyc-f-mobile').value.trim();
    k.email = document.getElementById('kyc-f-email').value.trim();
    k.address = document.getElementById('kyc-f-address').value.trim();
    k.city = document.getElementById('kyc-f-city').value.trim();
    k.state = document.getElementById('kyc-f-state').value;
    k.bankAcc = document.getElementById('kyc-f-bankacc').value.trim();
    k.ifsc = document.getElementById('kyc-f-ifsc').value.trim().toUpperCase();
    k.qualType = kycActiveQualTab;
    if (k.name) me.name = k.name; // keep the agent's display name in sync everywhere else in the app
    return true;
}

// Strict: collects the same fields as kycSaveDraft, but requires every field
// AND every required document to be present, then flips status to 'pending'.
function kycSubmitForApproval() {
    const me = kycMyAgent();
    if (!me) return false;
    kycEnsureShape(me);
    kycSaveDraft();
    const k = me.kyc;

    if (!k.name || !k.dob || !k.gender || !k.mobile || !k.email || !k.address || !k.city || !k.state || !k.bankAcc || !k.ifsc) {
        showToast('Please fill in all required basic information fields.', 'danger');
        return false;
    }
    const missingDocs = kycRequiredDocs(me).filter(key => !(me.kycDocs && me.kycDocs[key]));
    if (missingDocs.length) {
        showToast('Please upload all required documents before submitting.', 'danger');
        return false;
    }

    k.status = 'pending';
    k.rejectReason = '';
    k.submittedAt = Date.now();

    return true;
}

/* ============================================================
   ADMIN / DEVELOPER SIDE — KYC Approvals page
   ============================================================ */

const KYC_STATUS_LABEL = { not_submitted: 'Not Submitted', pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected' };
const KYC_STATUS_CLASS = { not_submitted: 'tk-status-closed', pending: 'tk-status-inprogress', approved: 'tk-status-resolved', rejected: 'kyc-status-rejected-pill' };

function renderKycApprovalsPage() {
    kycSyncBadgeAndMetrics();
    const list = document.getElementById('kyc-approvals-list');
    if (!list) return;

    agentState.forEach(kycEnsureShape);
    const sorted = [...agentState].sort((a, b) => {
        const order = { pending: 0, rejected: 1, not_submitted: 2, approved: 3 };
        return (order[a.kyc.status] ?? 9) - (order[b.kyc.status] ?? 9);
    });

    if (!sorted.length) {
        list.innerHTML = '<p class="empty-row">No agents yet.</p>';
        return;
    }

    list.innerHTML = sorted.map(a => `
        <div class="kyc-agent-row${a.id === kycSelectedAgentId ? ' kyc-row-selected' : ''}" data-ap-kyc-select="${a.id}">
            <div class="kyc-agent-avatar">${a.kycDocs?.photo ? `<img src="${a.kycDocs.photo}" alt="">` : escapeHTML(initials(a.kyc.name || a.name))}</div>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHTML(a.kyc.name || a.name)}</div>
                <div class="kyc-doc-progress">${escapeHTML(a.username)} · ${kycUploadedCount(a)}/6 documents</div>
            </div>
            <span class="tk-status-pill ${KYC_STATUS_CLASS[a.kyc.status]}">${KYC_STATUS_LABEL[a.kyc.status]}</span>
        </div>`).join('');

    list.querySelectorAll('[data-ap-kyc-select]').forEach(row => {
        row.addEventListener('click', () => { kycSelectedAgentId = row.dataset.apKycSelect; renderKycApprovalsPage(); });
    });

    if (kycSelectedAgentId) {
        const a = agentState.find(x => x.id === kycSelectedAgentId);
        if (a) renderKycReviewPanel(a);
    }
}

function renderKycReviewPanel(a) {
    const panel = document.getElementById('kyc-review-panel');
    if (!panel) return;
    kycEnsureShape(a);
    const k = a.kyc;

    if (k.status === 'not_submitted') {
        panel.innerHTML = `
            <div class="tk-detail-empty">
                <div class="tk-detail-empty-icon">🪪</div>
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:5px">${escapeHTML(a.name)} hasn't submitted KYC yet</div>
                <div style="font-size:12.5px">${kycUploadedCount(a)}/6 documents uploaded so far.</div>
            </div>`;
        return;
    }

    const docRow = (def) => {
        const doc = a.kycDocs && a.kycDocs[def.key];
        const isPdf = doc && doc.startsWith('data:application/pdf');
        return `<div class="kyc-review-doc-item" ${doc && !isPdf ? `data-ap-doc-zoom="${def.key}"` : ''}>
            ${doc ? (isPdf ? `<div class="kyc-rdi-missing">📄</div>` : `<img src="${doc}" alt="">`) : `<div class="kyc-rdi-missing">${def.icon}</div>`}
            <div class="kyc-rdi-label">${escapeHTML(def.title)}</div>
        </div>`;
    };
    const qualDef = KYC_DOC_DEFS.find(d => d.group === (k.qualType === '12th' ? 'qual12' : 'qual10'));
    const docsHtml = [...KYC_DOC_DEFS.filter(d => d.group === 'identity' || d.group === 'qr'), qualDef].map(docRow).join('');

    let actionsHtml = '';
    if (k.status === 'pending') {
        actionsHtml = `
            <div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)">
                <div class="tk-section-label" style="margin-top:0">Decision</div>
                <textarea class="form-input" id="kyc-reject-reason" rows="2" placeholder="Reason if rejecting (required to reject)…" style="margin-bottom:10px"></textarea>
                <div style="display:flex;gap:8px">
                    <button class="btn-primary" style="flex:1" data-ap-kyc-approve="${a.id}"><span class="icon-em">✅</span> Approve</button>
                    <button class="btn-secondary" style="flex:1" data-ap-kyc-reject="${a.id}"><span class="icon-em">✕</span> Reject</button>
                </div>
            </div>`;
    } else if (k.status === 'rejected') {
        actionsHtml = `<div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border)">
            <div class="tk-section-label" style="margin-top:0">Rejection Reason</div>
            <div class="tk-desc-full">${escapeHTML(k.rejectReason || '—')}</div>
        </div>`;
    } else if (k.status === 'approved') {
        actionsHtml = `<div style="margin-top:14px;padding-top:14px;border-top:0.5px solid var(--border);font-size:12px;color:var(--text-secondary)">
            Approved ${k.reviewedAt ? apTkTimeLabel(k.reviewedAt) : ''}${k.reviewedBy ? ' by ' + escapeHTML(k.reviewedBy) : ''}.
        </div>`;
    }

    panel.innerHTML = `
        <div class="tk-detail-head">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span class="tk-status-pill ${KYC_STATUS_CLASS[k.status]}">${KYC_STATUS_LABEL[k.status]}</span>
                <span style="font-size:11px;color:var(--text-tertiary)">Submitted ${k.submittedAt ? apTkTimeLabel(k.submittedAt) : '—'}</span>
            </div>
            <div class="tk-detail-title">${escapeHTML(k.name || a.name)}</div>
            <div class="tk-detail-meta"><span style="font-size:12px;color:var(--text-secondary)">${escapeHTML(a.username)}</span></div>
        </div>
        <div class="tk-detail-body">
            <div class="tk-section-label" style="margin-top:0">Basic Information</div>
            <div class="kyc-info-grid">
                <div><small>Date of Birth</small><strong>${escapeHTML(k.dob || '—')}</strong></div>
                <div><small>Gender</small><strong>${escapeHTML(k.gender || '—')}</strong></div>
                <div><small>Mobile</small><strong>${escapeHTML(k.mobile || '—')}</strong></div>
                <div><small>Email</small><strong>${escapeHTML(k.email || '—')}</strong></div>
                <div style="grid-column:1/-1"><small>Address</small><strong>${escapeHTML(k.address || '—')}, ${escapeHTML(k.city || '')}, ${escapeHTML(k.state || '')}</strong></div>
                <div><small>Bank Account</small><strong>${escapeHTML(k.bankAcc || '—')}</strong></div>
                <div><small>IFSC</small><strong>${escapeHTML(k.ifsc || '—')}</strong></div>
            </div>
            <div class="tk-section-label">Documents</div>
            <div class="kyc-review-doc-grid">${docsHtml}</div>
            ${actionsHtml}
        </div>`;

    panel.querySelector(`[data-ap-kyc-approve]`)?.addEventListener('click', () => kycDecide(a.id, 'approved'));
    panel.querySelector(`[data-ap-kyc-reject]`)?.addEventListener('click', () => kycDecide(a.id, 'rejected'));
    panel.querySelectorAll('[data-ap-doc-zoom]').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.apDocZoom;
            const src = a.kycDocs && a.kycDocs[key];
            if (src) window.open(src, '_blank');
        });
    });
}

function kycDecide(agentId, decision) {
    const a = agentState.find(x => x.id === agentId);
    if (!a) return;
    kycEnsureShape(a);
    if (decision === 'rejected') {
        const reason = document.getElementById('kyc-reject-reason')?.value.trim();
        if (!reason) return showToast('Please enter a reason for rejection.', 'danger');
        a.kyc.rejectReason = reason;
    }
    a.kyc.status = decision;
    a.kyc.reviewedAt = Date.now();
    a.kyc.reviewedBy = state.user?.role === 'developer' ? 'Developer' : 'Admin';
    addAudit('KYC ' + decision, `${decision === 'approved' ? 'Approved' : 'Rejected'} KYC for agent "${a.name}"`);
    saveState();
    renderKycApprovalsPage();
    showToast(`KYC ${decision} for ${a.name}.`, decision === 'approved' ? 'success' : 'warning');
}

function kycSyncBadgeAndMetrics() {
    agentState.forEach(kycEnsureShape);
    const pending = agentState.filter(a => a.kyc.status === 'pending').length;
    const approved = agentState.filter(a => a.kyc.status === 'approved').length;
    const rejected = agentState.filter(a => a.kyc.status === 'rejected').length;
    const notSubmitted = agentState.filter(a => a.kyc.status === 'not_submitted').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kyc-m-pending', pending);
    set('kyc-m-approved', approved);
    set('kyc-m-rejected', rejected);
    set('kyc-m-notsubmitted', notSubmitted);
    updateBadge('kycApprovalBadge', pending);
}

/* ============================================================
   WIRING
   ============================================================ */

function initKyc() {
    // Hidden universal file input shared by every document upload button
    if (!document.getElementById('kyc-photo-file-input-hidden')) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf';
        input.id = 'kyc-photo-file-input-hidden';
        input.className = 'hidden';
        document.body.appendChild(input);
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            kycHandleDocFile(file);
            input.value = '';
        });
    }

    document.getElementById('kyc-upload-photo-btn')?.addEventListener('click', () => kycTriggerDocUpload('photo'));

    document.getElementById('kyc-qual-tab-10')?.addEventListener('click', () => {
        kycActiveQualTab = '10th';
        const me = kycMyAgent();
        if (me) { document.getElementById('kyc-qual-tab-10').classList.add('active-tab'); document.getElementById('kyc-qual-tab-12').classList.remove('active-tab'); renderKycDocLists(me); kycUpdateSubmitBar(); }
    });
    document.getElementById('kyc-qual-tab-12')?.addEventListener('click', () => {
        kycActiveQualTab = '12th';
        const me = kycMyAgent();
        if (me) { document.getElementById('kyc-qual-tab-12').classList.add('active-tab'); document.getElementById('kyc-qual-tab-10').classList.remove('active-tab'); renderKycDocLists(me); kycUpdateSubmitBar(); }
    });

    const infoForm = document.getElementById('kycInfoForm');
    if (infoForm) {
        infoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const me = kycMyAgent();
            if (!me) return;
            const btn = document.getElementById('kyc-save-info-btn');
            const original = btn.textContent;
            btn.disabled = true; btn.textContent = 'Saving...';
            kycSaveDraft();
            await saveState();
            kycUpdateSubmitBar();
            refreshTopbarAvatar();
            renderAgentManager();
            showToast('Draft saved.', 'success');
            btn.disabled = false; btn.textContent = original;
        });
    }

    const submitBtn = document.getElementById('kyc-submit-approval-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const me = kycMyAgent();
            if (!me) return;
            const original = submitBtn.innerHTML;
            submitBtn.disabled = true; submitBtn.innerHTML = 'Submitting...';
            const ok = kycSubmitForApproval();
            if (ok) {
                await saveState();
                renderKycPage();
                refreshTopbarAvatar();
                renderAgentManager();
                addAudit('KYC submitted', `${me.name} submitted KYC for review`);
                showToast('Submitted for Hiring Authority approval.', 'success');
            } else {
                kycUpdateSubmitBar();
            }
            submitBtn.disabled = false; submitBtn.innerHTML = original;
        });
    }

    // Keep the submit bar's readiness state in sync as the person types or uploads,
    // without rewriting anything else on the page (so it never interrupts editing).
    ['kyc-f-name','kyc-f-dob','kyc-f-gender','kyc-f-mobile','kyc-f-email','kyc-f-address','kyc-f-city','kyc-f-state','kyc-f-bankacc','kyc-f-ifsc'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', kycUpdateSubmitBar);
        document.getElementById(id)?.addEventListener('change', kycUpdateSubmitBar);
    });

    kycUpdateSubmitBar();
}

// Lightweight readiness check for the submit bar — reads live DOM field values
// plus already-uploaded documents, never writes anything, never re-renders the form.
function kycUpdateSubmitBar() {
    const me = kycMyAgent();
    const bar = document.getElementById('kyc-submit-bar');
    const title = document.getElementById('kyc-submit-bar-title');
    const sub = document.getElementById('kyc-submit-bar-sub');
    const btn = document.getElementById('kyc-submit-approval-btn');
    if (!me || !bar) return;

    bar.classList.remove('kyc-bar-ready', 'kyc-bar-pending', 'kyc-bar-approved');

    if (me.kyc.status === 'approved') {
        bar.classList.add('kyc-bar-approved');
        title.textContent = 'Your account is verified ✅';
        sub.textContent = 'No further action needed.';
        btn.style.display = 'none';
        return;
    }
    if (me.kyc.status === 'pending') {
        bar.classList.add('kyc-bar-pending');
        title.textContent = 'Submitted — awaiting review';
        sub.textContent = 'You will be notified once the Hiring Authority reviews your submission.';
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';

    const fieldIds = { name: 'kyc-f-name', dob: 'kyc-f-dob', gender: 'kyc-f-gender', mobile: 'kyc-f-mobile', email: 'kyc-f-email', address: 'kyc-f-address', city: 'kyc-f-city', state: 'kyc-f-state', bankAcc: 'kyc-f-bankacc', ifsc: 'kyc-f-ifsc' };
    const missingFields = Object.values(fieldIds).filter(id => !document.getElementById(id)?.value.trim());
    const missingDocs = kycRequiredDocs(me).filter(key => !(me.kycDocs && me.kycDocs[key]));

    if (!missingFields.length && !missingDocs.length) {
        bar.classList.add('kyc-bar-ready');
        title.textContent = 'Everything looks complete ✅';
        sub.textContent = 'All required fields and documents are in. Submit whenever you\'re ready.';
    } else {
        const parts = [];
        if (missingFields.length) parts.push(missingFields.length + ' field' + (missingFields.length > 1 ? 's' : ''));
        if (missingDocs.length) parts.push(missingDocs.length + ' document' + (missingDocs.length > 1 ? 's' : ''));
        title.textContent = 'Almost there';
        sub.textContent = 'Still missing: ' + parts.join(' and ') + '.';
    }
}
