/* ============================================================
   app.js — Boot sequence. This is the ONLY script that runs on
   load; everything else is just function definitions.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initTheme();
    initAuth();        // shows login screen, or auto-enters app if session exists
    initSidebar();
    initWalletForms();
    initLoanActions();
    initLedgerActions();
    initClientActions();
    initSosActions();
    initAdminActions();
    initDevConsoleActions();
});
