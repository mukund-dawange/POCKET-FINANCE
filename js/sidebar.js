/* ============================================================
   sidebar.js — Sidebar navigation & section switching
   Add a new function/tool? Just:
     1. Add a <button class="tab-trigger" data-section="X"> in index.html sidebar
     2. Add a <section class="page-section" id="page-X"> in main content
   This file auto-wires the click handling for you.
   ============================================================ */

const SECTION_TITLES = {
    dashboard: 'Dashboard',
    settings: 'My Profile & KYC',
    wallet: 'Wallet Management',
    loans: 'Loan Accounts',
    clients: 'My Clients',
    agentwallet: 'My Wallet',
    schedule: 'Schedule',
    ledger: 'Master Ledger',
    sos: 'Tickets',
    myrank: 'My Rank',
    levels: 'Levels & Ranking',
    income: 'Income Overview',
    'kyc-approvals': 'KYC Approvals',
    adminledger: 'Personal Ledger',
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
    if (['wallet','admin','levels','income','kyc-approvals','adminledger'].includes(sectionKey) && !['admin','developer'].includes(state.user?.role)) sectionKey='dashboard';
    if (sectionKey==='myrank' && state.user?.role !== 'agent') sectionKey='dashboard';
    if (['clients','schedule','agentwallet'].includes(sectionKey) && state.user?.role !== 'agent') sectionKey='dashboard';
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

    // Sync bottom navigation active state
    syncBottomNav(sectionKey);

    // Close mobile sidebar after navigating
    closeMobileSidebar();

    localStorage.setItem('pf_lastSection', sectionKey);
    if(state.user) addAudit('Navigation', `Opened ${SECTION_TITLES[sectionKey] || sectionKey}`);
    if(sectionKey==='activity' && typeof renderAuditLog==='function') renderAuditLog();
    if(sectionKey==='settings' && typeof renderSettingsPage==='function') renderSettingsPage();
    if(sectionKey==='settings' && typeof renderKycPage==='function') renderKycPage();
    if((sectionKey==='myrank' || sectionKey==='levels') && typeof renderMyRankPage==='function') renderMyRankPage();
    if(sectionKey==='clients' && typeof renderClientsPage==='function') renderClientsPage();
    if(sectionKey==='agentwallet' && typeof renderAgentWalletPage==='function') renderAgentWalletPage();
    if(sectionKey==='schedule' && typeof renderSchedulePage==='function') renderSchedulePage();
    if(sectionKey==='sos' && typeof renderTicketsPage==='function') renderTicketsPage();
    if(sectionKey==='kyc-approvals' && typeof renderKycApprovalsPage==='function') renderKycApprovalsPage();
    if(sectionKey==='income' && typeof renderAdminIncomePanel==='function') renderAdminIncomePanel();
    if(sectionKey==='adminledger' && typeof renderAdminLedgerPage==='function') renderAdminLedgerPage();
}

/* ---- Bottom Navigation (mobile) ---------------------------------- */

const BOTTOM_NAV_TABS = {
    admin: [
        { section: 'dashboard', icon: 'fa-house',            label: 'Dashboard' },
        { section: 'loans',     icon: 'fa-hand-holding-dollar', label: 'Loans' },
        { section: 'wallet',    icon: 'fa-building-columns', label: 'Wallet' },
        { section: 'ledger',    icon: 'fa-clock-rotate-left',label: 'Ledger' },
        { section: null,        icon: 'fa-bars',             label: 'More', id: 'bnMore' },
    ],
    agent: [
        { section: 'dashboard', icon: 'fa-house',            label: 'Home' },
        { section: 'clients',   icon: 'fa-people-arrows',    label: 'Clients' },
        { section: 'schedule',  icon: 'fa-calendar-days',    label: 'Schedule' },
        { section: 'sos',       icon: 'fa-ticket',           label: 'Tickets', badgeId: 'bn-sos-badge' },
        { section: null,        icon: 'fa-bars',             label: 'More', id: 'bnMore' },
    ],
    developer: [
        { section: 'dashboard',   icon: 'fa-house',          label: 'Dashboard' },
        { section: 'loans',       icon: 'fa-hand-holding-dollar', label: 'Loans' },
        { section: 'devconsole',  icon: 'fa-terminal',       label: 'Dev' },
        { section: 'activity',    icon: 'fa-satellite-dish', label: 'Activity' },
        { section: null,          icon: 'fa-bars',           label: 'More', id: 'bnMore' },
    ],
};

function buildBottomNav(role) {
    const wrap = document.getElementById('bottomNavInner');
    if (!wrap) return;
    const tabs = BOTTOM_NAV_TABS[role] || BOTTOM_NAV_TABS.agent;
    wrap.innerHTML = '';
    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'bottom-nav-btn' + (tab.id ? ' bottom-nav-more' : '');
        if (tab.id) btn.id = tab.id;
        if (tab.section) btn.dataset.bnSection = tab.section;

        let badgeHtml = '';
        if (tab.badgeId) {
            badgeHtml = `<span class="nav-badge" id="${tab.badgeId}">0</span>`;
        }
        btn.innerHTML = `<i class="fa-solid ${tab.icon}"></i>${badgeHtml}<span>${tab.label}</span>`;

        if (tab.section) {
            btn.addEventListener('click', () => switchSection(tab.section));
        } else {
            // "More" opens the sidebar
            btn.addEventListener('click', () => {
                document.getElementById('sidebar').classList.toggle('mobile-open');
                document.getElementById('sidebarBackdrop')?.classList.toggle('show');
            });
        }
        wrap.appendChild(btn);
    });
}

function syncBottomNav(sectionKey) {
    document.querySelectorAll('.bottom-nav-btn[data-bn-section]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bnSection === sectionKey);
    });
}

function updateBottomNavBadge(badgeId, count) {
    const el = document.getElementById(badgeId);
    if (!el) return;
    el.textContent = count > 99 ? '99+' : count;
    el.classList.toggle('show', count > 0);
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
