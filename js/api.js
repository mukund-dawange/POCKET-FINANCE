/* ============================================================
   api.js — Connects to the shared Apps Script + Drive backend
   that now owns ALL login credentials.
   ------------------------------------------------------------
   No device stores its own copy of accounts anymore. Every
   login check and every credential change goes straight to
   this one backend, so a change the developer makes is the
   only valid login everywhere, immediately.

   Paste your deployed Apps Script Web App URL below.
   ============================================================ */

const ACCOUNTS_API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

async function apiPost(action, data = {}) {
    if (!ACCOUNTS_API_URL || ACCOUNTS_API_URL.includes('PASTE_YOUR')) {
        return { success: false, message: 'Login backend is not configured yet. Set ACCOUNTS_API_URL in js/api.js.' };
    }
    try {
        // Plain string body (no custom Content-Type header) avoids a CORS
        // preflight, which Apps Script Web Apps don't handle.
        const res = await fetch(ACCOUNTS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action, ...data })
        });
        return await res.json();
    } catch (err) {
        console.error('Backend request failed:', err);
        return { success: false, message: 'Could not reach the login server. Check your connection and try again.' };
    }
}

function apiLogin(username, password) {
    return apiPost('login', { username, password });
}
function apiCheckGoogle(email) {
    return apiPost('checkGoogle', { email });
}
function apiListAccounts() {
    return apiPost('listAccounts');
}
function apiUpdateAccount({ role, username, password, googleEmail }) {
    return apiPost('updateAccount', {
        requesterUsername: state.user?.username || '',
        role, username, password, googleEmail
    });
}
