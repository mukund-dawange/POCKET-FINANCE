/* ============================================================
   ui.js — Shared UI helpers (toasts, formatting, theme toggle)
   ============================================================ */

function fmtINR(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// DM can now hold decimal values (e.g. ₹150 given → 1.50 DM), so always
// show 2 decimal places rather than flooring to a whole number.
function fmtDM(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(message, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return false;
    const icons = { success: 'fa-circle-check', warning: 'fa-triangle-exclamation', danger: 'fa-circle-xmark', info: 'fa-circle-info' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity .3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3500);
    // Return false for danger/warning toasts so that `return showToast(...)`
    // validation-guard patterns (used everywhere for early-exit on invalid
    // input) also signal failure to whoever called the function — e.g. a
    // form modal's onSubmit, so it knows NOT to close and silently discard
    // the user's input. Success/info toasts return true.
    return type !== 'danger' && type !== 'warning';
}

function updateBadge(elId, count) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = count;
    el.classList.toggle('show', count > 0);
    // Mirror to bottom nav badge if applicable
    if (elId === 'sosBadge') {
        if (typeof updateBottomNavBadge === 'function') updateBottomNavBadge('bn-sos-badge', count);
    }
}

/* ---------------- MODAL FORM ----------------
   showFormModal({
     title: 'Add Client',
     icon: 'fa-user-plus',
     fields: [
       { id: 'name', label: 'Client Name', type: 'text', required: true, placeholder: 'e.g. Rahul Verma' },
       { id: 'phone', label: 'Phone Number', type: 'text', placeholder: 'Optional' }
     ],
     submitLabel: 'Add Client',
     onSubmit: (values) => { ... values.name, values.phone ... }
   })
------------------------------------------------ */
function showFormModal({ title, icon = 'fa-pen', fields = [], submitLabel = 'Save', onSubmit, wide = false, intro = '' }) {
    // Remove any existing modal first
    const existing = document.getElementById('formModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'formModalOverlay';
    overlay.className = `modal-overlay${wide ? ' modal-form-wide' : ''}`;

    const fieldsHTML = fields.map(f => `
        <div class="modal-field ${f.full ? 'full' : ''}">
        <label class="modal-field-label" for="modalField_${f.id}">${f.label}${f.required ? ' *' : ''}</label>
        ${f.type === 'select'
            ? `<select id="modalField_${f.id}" ${f.required ? 'required' : ''}>
                 ${(f.options || []).map(o => `<option value="${o.value}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${o.label}</option>`).join('')}
               </select>`
            : f.type === 'textarea'
            ? `<textarea id="modalField_${f.id}" placeholder="${f.placeholder || ''}" rows="${f.rows || 4}" ${f.required ? 'required' : ''}>${f.value || ''}</textarea>`
            : `<input type="${f.type || 'text'}" id="modalField_${f.id}" value="${f.value || ''}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.numeric ? `inputmode="numeric" pattern="[0-9]*"` : ''}>`
        }
        ${f.help ? `<small class="modal-field-help">${f.help}</small>` : ''}
        </div>
    `).join('');

    overlay.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <div class="modal-icon"><i class="fa-solid ${icon}"></i></div>
                <h3>${title}</h3>
                <button class="modal-close-btn" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <form id="modalForm">
                <div class="modal-body">
                    ${intro ? `<p class="modal-intro">${intro}</p>` : ''}
                    <div class="modal-fields-grid">${fieldsHTML}</div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn-friendly-secondary" id="modalCancelBtn">Cancel</button>
                    <button type="submit" class="btn-friendly-primary">${submitLabel}</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById(`modalField_${fields[0]?.id}`)?.focus(), 50);

    // Numeric-restricted fields (e.g. a 10-digit phone number): strip any
    // non-digit characters as the person types, and hard-cap at maxlength
    // so it's impossible to type more digits than allowed — instead of
    // only catching it (and losing the whole form) at submit time.
    fields.forEach(f => {
        if (!f.numeric) return;
        const el = document.getElementById(`modalField_${f.id}`);
        if (!el) return;
        el.addEventListener('input', () => {
            let digitsOnly = el.value.replace(/\D/g, '');
            if (f.maxlength) digitsOnly = digitsOnly.slice(0, Number(f.maxlength));
            if (digitsOnly !== el.value) el.value = digitsOnly;
        });
    });

    const close = () => overlay.remove();
    document.getElementById('modalCloseBtn').addEventListener('click', close);
    document.getElementById('modalCancelBtn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('modalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        clearFieldErrors();
        const values = {};
        fields.forEach(f => { values[f.id] = document.getElementById(`modalField_${f.id}`).value.trim(); });
        // IMPORTANT: run onSubmit BEFORE closing. If it fails validation
        // (any `return showToast(msg, 'danger'/'warning')` early-exit),
        // showToast now returns false, which propagates out as onSubmit's
        // return value — keep the modal open in that case so the error is
        // visible and the input isn't silently thrown away. Previously the
        // modal closed unconditionally first, so a failed "Set Allocation"
        // (e.g. amount over the level's cap) looked like it succeeded while
        // nothing was actually saved.
        const result = onSubmit(values);
        if (result === false) return;
        close();
    });
}

// Highlights a specific field in the currently-open form modal with a red
// box + inline message, instead of just showing a toast and leaving the
// person unsure which field was wrong. The modal is never closed/reset by
// this — whatever the person already typed stays exactly as it was.
function markFieldError(fieldId, message) {
    const input = document.getElementById(`modalField_${fieldId}`);
    const wrap = input?.closest('.modal-field');
    if (!wrap) return;
    wrap.classList.add('field-error');
    let msgEl = wrap.querySelector('.field-error-msg');
    if (!msgEl) {
        msgEl = document.createElement('small');
        msgEl.className = 'field-error-msg';
        wrap.appendChild(msgEl);
    }
    msgEl.textContent = message;
}

function clearFieldErrors() {
    document.querySelectorAll('#formModalOverlay .modal-field.field-error').forEach(wrap => {
        wrap.classList.remove('field-error');
        wrap.querySelector('.field-error-msg')?.remove();
    });
}

/* ---------------- THEME ---------------- */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pf_theme', theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.innerHTML = theme === 'dark'
            ? '<i class="fa-solid fa-sun"></i><span>Light Mode</span>'
            : '<i class="fa-solid fa-moon"></i><span>Dark Mode</span>';
    }
}

function initTheme() {
    const saved = localStorage.getItem('pf_theme') || 'light';
    applyTheme(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}
