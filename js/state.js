/* ============================================================
   state.js — Central app state
   The logged-in session (state.user) stays local to this device
   on purpose — that's just "who's signed in on this browser."
   Everything else (wallet, loans, clients, logs, sos, agentState)
   is the actual shared data, and now lives in the same Drive
   backend that auth uses (js/api.js), under one key. No browser
   keeps its own private copy anymore, so a fresh browser sees
   the same data as every other device.

   AUTO-SYNC: Every SYNC_INTERVAL_MS the app silently re-fetches
   the shared state from the backend and re-renders, so all open
   browsers stay in sync with each other automatically.
   ============================================================ */

const SESSION_KEY = 'pf_session_v1';     // local-only: who is logged in on this device
const APP_STATE_KEY = 'pf_appState';     // shared backend key: everything else

// ---- Sync config ----
const SYNC_INTERVAL_MS = 20000;   // poll every 20 seconds
let   _syncIntervalId  = null;    // handle so we can clear/restart it
let   _isSaving        = false;   // guard: don't poll while a save is in flight

// ---- Sync indicator helpers ----
function _setSyncIndicator(status) {
    // status: 'ok' | 'saving' | 'error' | 'syncing'
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    const icons = { ok: '☁️', saving: '💾', error: '⚠️', syncing: '🔄' };
    const labels = { ok: 'Synced', saving: 'Saving…', error: 'Sync error', syncing: 'Syncing…' };
    el.dataset.status = status;
    el.title = labels[status] || '';
    el.textContent = (icons[status] || '') + ' ' + (labels[status] || '');
}

let state = {
    wallet: { cash: 0, online: 0 },
    loans: [],
    loanTrash: [],
    clients: [],   // { id, name, phone, outstanding }
    logs: [],      // { id, timestampMs, description, typeClass: 'income'|'expense', impactStr }
    sos: [],       // { id, raisedOn, reason, status }
    levelDefs: [], // { id, name, rankName, targetPct, allocationLimit, benefits: [string,...], order }
    user: null     // { username, role: 'admin'|'agent' } — local session only, never synced
};

let agentState = []; // { id, name, fund }
const AUDIT_KEY = 'pocketFinanceAudit_v1';

// NOTE: Login credentials are not stored here at all — they live in
// the shared Drive file via js/api.js (apiLogin/apiListAccounts/etc).

function getAuditLog(){try{return JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]')}catch{return[]}}
function addAudit(action,details='',user=state.user){
    const logs=getAuditLog();
    logs.unshift({id:genId('audit'),timestamp:Date.now(),username:user?.username||'Guest',role:user?.role||'guest',action,details});
    localStorage.setItem(AUDIT_KEY,JSON.stringify(logs.slice(0,500)));
}

async function saveState() {
    // Session: who's logged in on THIS device — stays local on purpose.
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: state.user }));
    } catch (e) {
        console.error('Failed to save session:', e);
    }

    // Everything else: shared data, goes to the Drive backend.
    _isSaving = true;
    _setSyncIndicator('saving');
    const { user, ...sharedState } = state;
    try {
        await apiWriteKey(APP_STATE_KEY, { state: sharedState, agentState });
        _setSyncIndicator('ok');
    } catch (e) {
        console.error('Failed to save shared state:', e);
        _setSyncIndicator('error');
    } finally {
        _isSaving = false;
    }
}

async function loadState() {
    // Restore this device's own login session
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.user) state.user = parsed.user;
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }

    // Pull the shared financial data from the backend
    try {
        const res = await apiReadKey(APP_STATE_KEY);
        if (res && res.value) {
            // Always preserve who is logged in on THIS device — never overwrite from backend
            const currentUser = state.user;
            if (res.value.state) state = Object.assign(state, res.value.state);
            if (res.value.agentState) agentState = res.value.agentState;
            state.user = currentUser;  // restore local session
        }
        _setSyncIndicator('ok');
    } catch (e) {
        console.error('Failed to load shared state:', e);
        _setSyncIndicator('error');
    }
}

// ---- Background sync: silently re-fetch + re-render on a timer ----
// Called by enterApp(); stopped on logout.
function startAutoSync() {
    stopAutoSync();
    _syncIntervalId = setInterval(async () => {
        if (_isSaving || !state.user) return;   // skip poll while saving or logged out
        _setSyncIndicator('syncing');
        try {
            const res = await apiReadKey(APP_STATE_KEY);
            if (res && res.value) {
                const currentUser = state.user;
                if (res.value.state) state = Object.assign(state, res.value.state);
                if (res.value.agentState) agentState = res.value.agentState;
                state.user = currentUser;
                if (typeof renderAll === 'function') renderAll();
            }
            _setSyncIndicator('ok');
        } catch (e) {
            console.error('Auto-sync failed:', e);
            _setSyncIndicator('error');
        }
    }, SYNC_INTERVAL_MS);
}

function stopAutoSync() {
    if (_syncIntervalId !== null) {
        clearInterval(_syncIntervalId);
        _syncIntervalId = null;
    }
}

async function resetState() {
    state = { wallet: { cash: 0, online: 0 }, loans: [], loanTrash: [], clients: [], logs: [], sos: [], levelDefs: [], user: state.user };
    agentState = [];
    await saveState();
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
