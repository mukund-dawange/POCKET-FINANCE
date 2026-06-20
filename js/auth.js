/* ============================================================
   auth.js — Login / logout
   Demo-only credential check. Replace checkCredentials() with a
   real API/Apps Script call when you wire up a backend.
   ============================================================ */

const DEMO_USERS = {
    admin: { password: 'admin', role: 'admin' },
    agent: { password: 'agent', role: 'agent' }
};

function checkCredentials(username, password) {
    const u = DEMO_USERS[username.toLowerCase()];
    if (u && u.password === password) {
        return { username, role: u.role };
    }
    return null;
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
            showToastOnLogin('Invalid username or password.', 'danger');
            return;
        }

        state.user = user;
        saveState();
        enterApp();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        state.user = null;
        saveState();
        document.getElementById('appShell').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('loginForm').reset();
    });

    // Auto-login if a session already exists
    if (state.user) {
        enterApp();
    }
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
    const isAdmin = state.user.role === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });

    renderAll();
}
