/* ============================================================
   app.js — Boot sequence. This is the ONLY script that runs on
   load; everything else is just function definitions.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();

    showToastOnLogin('Loading your data…', 'info');
    await loadState();             // pulls shared wallet/loans/etc. from the Drive backend
    if (typeof loadProfiles === 'function') await loadProfiles(); // pulls admin/developer profile extras
    showToastOnLogin('', 'info');  // clear the loading message

    initAuth();        // shows login screen, or auto-enters app if session exists
    initSidebar();
    initWalletForms();
    initLoanActions();
    initLedgerActions();
    if (typeof initAdminLedgerActions === 'function') initAdminLedgerActions();
    initSosActions();
    initAdminActions();
    initDevConsoleActions();
    if (typeof initSettings === 'function') initSettings();
    if (typeof initKyc === 'function') initKyc();
    if (typeof initDocViewer === 'function') initDocViewer();
    if (typeof initRanking === 'function') initRanking();
    if (typeof initAgentPortal === 'function') initAgentPortal();
});
