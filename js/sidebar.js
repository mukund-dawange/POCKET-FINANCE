/* ============================================================
   sidebar.js — Sidebar navigation & section switching
   Add a new function/tool? Just:
     1. Add a <button class="tab-trigger" data-section="X"> in index.html sidebar
     2. Add a <section class="page-section" id="page-X"> in main content
   This file auto-wires the click handling for you.
   ============================================================ */

const SECTION_TITLES = {
    dashboard: 'Dashboard',
    settings: 'Settings',
    wallet: 'Wallet Management',
    loans: 'Loan Accounts',
    ledger: 'Master Ledger',
    sos: 'SOS Requests',
    admin: 'Admin Panel',
    devconsole: 'Dev Console',
    access: 'Access Manager',
    activity: 'Live Activity',
    danger: 'Danger Zone'
};

function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.remove('show');
}

function switchSection(sectionKey) {
    if (['access','activity','danger','devconsole'].includes(sectionKey) && state.user?.role !== 'developer') sectionKey='dashboard';
    if (['wallet','admin'].includes(sectionKey) && !['admin','developer'].includes(state.user?.role)) sectionKey='dashboard';
    document.querySelectorAll('.tab-trigger[data-section]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === sectionKey);
    });
    document.querySelectorAll('.page-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === 'page-' + sectionKey);
    });

    const title = document.getElementById('pageTitle');
    if (title) title.textContent = SECTION_TITLES[sectionKey] || sectionKey;

    // Re-render charts when dashboard becomes visible (canvas needs to be in DOM)
    if (sectionKey === 'dashboard' && typeof renderAnalyticsCharts === 'function') {
        setTimeout(renderAnalyticsCharts, 50);
    }

    // Close mobile sidebar after navigating
    closeMobileSidebar();

    localStorage.setItem('pf_lastSection', sectionKey);
    if(state.user) addAudit('Navigation', `Opened ${SECTION_TITLES[sectionKey] || sectionKey}`);
    if(sectionKey==='activity' && typeof renderAuditLog==='function') renderAuditLog();
    if(sectionKey==='settings' && typeof renderSettingsPage==='function') renderSettingsPage();
}

function initSidebar() {
    document.querySelectorAll('.tab-trigger[data-section]').forEach(btn => {
        btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });

    document.getElementById('collapseBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });

    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.toggle('show');
    });

    document.getElementById('sidebarBackdrop')?.addEventListener('click', closeMobileSidebar);

    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Restore last visited section (defaults to dashboard)
    const last = localStorage.getItem('pf_lastSection') || 'dashboard';
    switchSection(last);
}
