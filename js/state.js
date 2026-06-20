/* ============================================================
   state.js — Central app state + localStorage persistence
   This is the single source of truth for all data in the app.
   Swap saveState()/loadState() for real API calls later if you
   connect a Google Apps Script backend (see Admin Panel).
   ============================================================ */

const STORAGE_KEY = 'pocketFinanceState_v1';

let state = {
    wallet: { cash: 0, online: 0 },
    loans: [],
    loanTrash: [],
    clients: [],   // { id, name, phone, outstanding }
    logs: [],      // { id, timestampMs, description, typeClass: 'income'|'expense', impactStr }
    sos: [],       // { id, raisedOn, reason, status }
    user: null     // { username, role: 'admin'|'agent' }
};

let agentState = []; // { id, name, fund }
const AUDIT_KEY = 'pocketFinanceAudit_v1';

// NOTE: Login credentials are no longer stored in localStorage at all.
// They live in one shared Drive file via the Apps Script backend
// (see js/api.js). That's the single source of truth for every
// device — the old getAccounts()/saveAccounts() localStorage-seeding
// behavior is why a developer's credential change on one device
// never showed up on another.

function getAuditLog(){try{return JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]')}catch{return[]}}
function addAudit(action,details='',user=state.user){
    const logs=getAuditLog();
    logs.unshift({id:genId('audit'),timestamp:Date.now(),username:user?.username||'Guest',role:user?.role||'guest',action,details});
    localStorage.setItem(AUDIT_KEY,JSON.stringify(logs.slice(0,500)));
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, agentState }));
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.state) state = Object.assign(state, parsed.state);
            if (parsed.agentState) agentState = parsed.agentState;
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }
}

function resetState() {
    localStorage.removeItem(STORAGE_KEY);
    state = { wallet: { cash: 0, online: 0 }, loans: [], loanTrash: [], clients: [], logs: [], sos: [], user: state.user };
    agentState = [];
    saveState();
}

function addLog(description, typeClass, impactAmount) {
    const sign = typeClass === 'expense' ? '-' : '+';
    state.logs.unshift({
        id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        timestampMs: Date.now(),
        description,
        typeClass,
        impactStr: sign + '₹' + Math.abs(impactAmount).toLocaleString('en-IN')
    });
    saveState();
    addAudit('Financial action', description);
}

function genId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}
