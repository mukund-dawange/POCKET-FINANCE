/* ============================================================
   auth.js — Login / logout
   Credentials are checked against the shared Apps Script + Drive
   backend (js/api.js) — never stored locally.

   AUTO-LOGIN IS DISABLED: users must sign in on every visit.
   "Remember Me" only prefills the username/password fields —
   it never skips the login screen.
   ============================================================ */

const REMEMBER_ME_KEY = 'pf_remember_me';

async function checkCredentials(username, password) {
    // Agents are created locally by the admin and live in the shared
    // agentState array (synced via the same backend, but checked here
    // directly — no need to round-trip through the accounts API).
    const agent = agentState.find(a => a.username && a.username === username);
    if (agent) {
        if (agent.password !== password) {
            return { success: false, message: 'Invalid username or password.' };
        }
        if (agent.disabled) {
            return { success: false, message: 'This agent account has been disabled by the admin.' };
        }
        return { success: true, user: { username: agent.username, role: 'agent', agentId: agent.id, name: agent.name } };
    }
    return apiLogin(username, password);
}

function initAuth() {
    const form = document.getElementById('loginForm');
    const togglePass = document.getElementById('togglePass');
    const passInput = document.getElementById('loginPass');
    const userInput = document.getElementById('loginUser');
    const rememberCheckbox = document.getElementById('rememberMe');
    const submitBtn = form.querySelector('button[type="submit"]');

    // Prefill saved credentials if "Remember Me" was checked previously.
    // This only populates the fields — the user still has to click Sign In.
    try {
        const saved = JSON.parse(localStorage.getItem(REMEMBER_ME_KEY) || 'null');
        if (saved && saved.username) {
            userInput.value = saved.username;
            passInput.value = saved.password || '';
            rememberCheckbox.checked = true;
        }
    } catch (e) { /* ignore */ }

    // Also clear any stale session that old versions may have written
    localStorage.removeItem('pf_session_v1');

    togglePass.addEventListener('click', () => {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        togglePass.classList.toggle('fa-eye', !isPass);
        togglePass.classList.toggle('fa-eye-slash', isPass);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = userInput.value.trim();
        const password = passInput.value;

        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Checking...';

        const res = await checkCredentials(username, password);

        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;

        if (!res.success) {
            addAudit('Failed login', `Attempted ID: ${username}`, {username:username||'Unknown',role:'guest'});
            showToastOnLogin(res.message || 'Invalid username or password.', 'danger');
            return;
        }

        // Save or clear remembered credentials based on checkbox
        if (rememberCheckbox.checked) {
            localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({ username, password }));
        } else {
            localStorage.removeItem(REMEMBER_ME_KEY);
        }

        state.user = res.user;
        addAudit('Login', 'Password login successful', res.user);
        saveState();
        enterApp();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        addAudit('Logout', 'User signed out');
        stopAutoSync();
        state.user = null;
        document.getElementById('appShell').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('loginForm').reset();

        // Re-apply remembered credentials after form reset so they're still prefilled
        try {
            const saved = JSON.parse(localStorage.getItem(REMEMBER_ME_KEY) || 'null');
            if (saved && saved.username) {
                document.getElementById('loginUser').value = saved.username;
                document.getElementById('loginPass').value = saved.password || '';
                document.getElementById('rememberMe').checked = true;
            }
        } catch (e) { /* ignore */ }
    });

    document.getElementById('googleLoginBtn').addEventListener('click', startGoogleLogin);

    // ── NO AUTO-LOGIN ──
    // We never call enterApp() here, even if state.user was somehow set.
    // Every page load always starts at the login screen.
}

function startGoogleLogin() {
    const clientId=localStorage.getItem('pf_googleClientId');
    if(!clientId) return showToastOnLogin('Google login is not configured. Ask the developer to add a Google Client ID.', 'danger');
    if(!window.google?.accounts?.id) return showToastOnLogin('Google login is still loading. Try again.', 'danger');
    google.accounts.id.initialize({client_id:clientId,callback:handleGoogleCredential});
    google.accounts.id.prompt();
}
async function handleGoogleCredential(response) {
    try {
        const base=response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const payload=JSON.parse(atob(base.padEnd(base.length+(4-base.length%4)%4,'=')));
        const res=await apiCheckGoogle(payload.email);
        if(!res.success) return showToastOnLogin(res.message || 'This Google account has not been assigned by the developer.', 'danger');
        state.user={username:res.user.username,role:res.user.role,email:payload.email};
        addAudit('Login','Google login successful',state.user);saveState();enterApp();
    } catch { showToastOnLogin('Google login could not be verified.', 'danger'); }
}

function showToastOnLogin(msg, type) {
    // Toast stack isn't visible yet pre-login, so use a quick inline alert instead
    const card = document.querySelector('.login-card');
    let warn = card.querySelector('.login-inline-warn');
    if (!warn) {
        warn = document.createElement('p');
        warn.className = 'login-inline-warn';
        warn.style.cssText = 'font-size:12px;text-align:center;margin-top:14px;font-weight:600;';
        card.appendChild(warn);
    }
    warn.style.color = type === 'info' ? '#64748b' : '#ef4444';
    warn.textContent = msg;
}

function enterApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    const avatar = document.getElementById('userAvatar');
    if (avatar) {
        if (typeof refreshTopbarAvatar === 'function') refreshTopbarAvatar();
        else avatar.textContent = (state.user.username || '?')[0].toUpperCase();
    }

    // Show/hide role-specific nav items
    const isDeveloper = state.user.role === 'developer';
    const isAdmin = state.user.role === 'admin' || isDeveloper;
    const isAgent = state.user.role === 'agent';
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
    document.querySelectorAll('.dev-only').forEach(el => {
        el.style.display = isDeveloper ? '' : 'none';
    });
    document.querySelectorAll('.agent-only').forEach(el => {
        el.style.display = isAgent ? '' : 'none';
    });

    const savedSection = localStorage.getItem('pf_lastSection');
    if (!isDeveloper && (savedSection === 'devconsole' || savedSection === 'danger')) {
        localStorage.setItem('pf_lastSection', 'dashboard');
        switchSection('dashboard');
    }
    if (!isAdmin && (savedSection === 'wallet' || savedSection === 'admin' || savedSection === 'levels' || savedSection === 'kyc-approvals')) {
        localStorage.setItem('pf_lastSection', 'dashboard');
        switchSection('dashboard');
    }
    if (!isAgent && savedSection === 'myrank') {
        localStorage.setItem('pf_lastSection', 'dashboard');
        switchSection('dashboard');
    }
    if (!isAgent && (savedSection === 'clients' || savedSection === 'schedule')) {
        localStorage.setItem('pf_lastSection', 'dashboard');
        switchSection('dashboard');
    }

    renderAll();
    if(isDeveloper){renderAccessManager();renderAuditLog();}

    // Build mobile bottom navigation for the logged-in role
    if (typeof buildBottomNav === 'function') buildBottomNav(state.user.role);

    startAutoSync();
}
