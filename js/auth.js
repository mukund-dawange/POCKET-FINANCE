/* ============================================================
   auth.js — Login / logout
   Demo-only credential check. Replace checkCredentials() with a
   real API/Apps Script call when you wire up a backend.
   ============================================================ */

function checkCredentials(username, password) {
    const u=getAccounts().find(a=>a.username.toLowerCase()===username.toLowerCase() && a.password===password);
    return u ? {username:u.username,role:u.role} : null;
}

function initAuth() {
    const form = document.getElementById('loginForm');
    const togglePass = document.getElementById('togglePass');
    const passInput = document.getElementById('loginPass');

    togglePass.addEventListener('click', () => {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        togglePass.classList.toggle('fa-eye', !isPass);
        togglePass.classList.toggle('fa-eye-slash', isPass);
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUser').value.trim();
        const password = document.getElementById('loginPass').value;
        const user = checkCredentials(username, password);

        if (!user) {
            addAudit('Failed login', `Attempted ID: ${username}`, {username:username||'Unknown',role:'guest'});
            showToastOnLogin('Invalid username or password.', 'danger');
            return;
        }

        state.user = user;
        addAudit('Login', 'Password login successful', user);
        saveState();
        enterApp();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        addAudit('Logout', 'User signed out');
        state.user = null;
        saveState();
        document.getElementById('appShell').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('loginForm').reset();
    });
    document.getElementById('googleLoginBtn').addEventListener('click', startGoogleLogin);

    // Auto-login if a session already exists
    if (state.user) {
        enterApp();
    }
}

function startGoogleLogin() {
    const clientId=localStorage.getItem('pf_googleClientId');
    if(!clientId) return showToastOnLogin('Google login is not configured. Ask the developer to add a Google Client ID.', 'danger');
    if(!window.google?.accounts?.id) return showToastOnLogin('Google login is still loading. Try again.', 'danger');
    google.accounts.id.initialize({client_id:clientId,callback:handleGoogleCredential});
    google.accounts.id.prompt();
}
function handleGoogleCredential(response) {
    try {
        const base=response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const payload=JSON.parse(atob(base.padEnd(base.length+(4-base.length%4)%4,'=')));
        const account=getAccounts().find(a=>a.googleEmail?.toLowerCase()===payload.email.toLowerCase());
        if(!account) return showToastOnLogin('This Google account has not been assigned by the developer.', 'danger');
        state.user={username:account.username,role:account.role,email:payload.email};
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
        warn.style.cssText = 'color:#ef4444;font-size:12px;text-align:center;margin-top:14px;font-weight:600;';
        card.appendChild(warn);
    }
    warn.textContent = msg;
}

function enterApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    const avatar = document.getElementById('userAvatar');
    if (avatar) avatar.textContent = (state.user.username || '?')[0].toUpperCase();

    // Show/hide admin-only nav items based on role
    const isDeveloper = state.user.role === 'developer';
    const isAdmin = state.user.role === 'admin' || isDeveloper;
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
    document.querySelectorAll('.dev-only').forEach(el => {
        el.style.display = isDeveloper ? '' : 'none';
    });

    const savedSection = localStorage.getItem('pf_lastSection');
    if (!isDeveloper && (savedSection === 'devconsole' || savedSection === 'danger')) {
        localStorage.setItem('pf_lastSection', 'dashboard');
        switchSection('dashboard');
    }

    renderAll();
    if(isDeveloper){renderAccessManager();renderAuditLog();}
}
