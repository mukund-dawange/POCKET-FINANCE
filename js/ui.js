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
