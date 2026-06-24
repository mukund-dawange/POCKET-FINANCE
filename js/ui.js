/* ============================================================
   ui.js — Shared UI helpers (toasts, formatting, theme toggle)
   ============================================================ */

function fmtINR(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function showToast(message, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
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
}

function updateBadge(elId, count) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = count;
    el.classList.toggle('show', count > 0);
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
            : `<input type="${f.type || 'text'}" id="modalField_${f.id}" value="${f.value || ''}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}>`
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

    const close = () => overlay.remove();
    document.getElementById('modalCloseBtn').addEventListener('click', close);
    document.getElementById('modalCancelBtn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('modalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        fields.forEach(f => { values[f.id] = document.getElementById(`modalField_${f.id}`).value.trim(); });
        close();
        onSubmit(values);
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
