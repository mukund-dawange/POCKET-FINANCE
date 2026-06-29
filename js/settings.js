/* ============================================================
   settings.js — Account Settings (available to every role)
   ------------------------------------------------------------
   - Agents already have their own record in `agentState`
     (synced via saveState → shared backend), so their profile
     extras (display name, phone, bio, avatar) just live as more
     fields on that same record. No new storage needed for them.
   - Admin & Developer are singleton logins (one shared ID per
     role, managed in Access Manager), so they have nowhere to
     keep personal extras. We give them a small dedicated shared
     key, "pf_profiles", keyed by ROLE (not username) so it keeps
     working even if the developer changes that role's login ID.
   - Profile photos are resized/cropped client-side to a small
     square JPEG data URL before saving, so they stay light
     enough for the shared Drive-backed JSON store.
   ============================================================ */

const PROFILES_KEY = 'pf_profiles';
let profiles = {}; // { admin: {displayName,phone,bio,avatar,updatedAt}, developer: {...} }

function isSingletonRole(role) {
    return role === 'admin' || role === 'developer';
}

async function loadProfiles() {
    try {
        const res = await apiReadKey(PROFILES_KEY);
        if (res && res.value) profiles = res.value;
    } catch (e) {
        console.error('Failed to load profiles:', e);
    }
}

async function saveProfiles() {
    try {
        await apiWriteKey(PROFILES_KEY, profiles);
    } catch (e) {
        console.error('Failed to save profiles:', e);
    }
}

// The single editable object that holds "my" profile fields (admin/developer — agents use kyc.js).
function getMyProfileSource() {
    if (!state.user || state.user.role === 'agent') return null;
    if (isSingletonRole(state.user.role)) {
        if (!profiles[state.user.role]) profiles[state.user.role] = {};
        return profiles[state.user.role];
    }
    return null;
}

async function persistMyProfile() {
    if (isSingletonRole(state.user.role)) {
        await saveProfiles();
    }
}

function myDisplayName(src) {
    if (!src) return state.user?.username || '';
    return src.displayName || '';
}

function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const letters = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    return (letters || name[0] || '?').toUpperCase();
}

function avatarMarkup(src, fallbackText) {
    return src ? `<img src="${src}" alt="">` : escapeHTML(fallbackText || '?');
}

/* ---------------- TOPBAR AVATAR ---------------- */
function refreshTopbarAvatar() {
    const el = document.getElementById('userAvatar');
    if (!el || !state.user) return;
    const src = getMyProfileSource();
    const name = myDisplayName(src) || state.user.username;
    el.innerHTML = avatarMarkup(src?.avatar, initials(name));
    el.classList.toggle('has-image', !!src?.avatar);
}

/* ---------------- SETTINGS PAGE RENDER (admin/developer only — agents use My Profile & KYC) ---------------- */
function renderSettingsPage() {
    if (!state.user || state.user.role === 'agent') return;
    const src = getMyProfileSource() || {};
    const displayName = myDisplayName(src);

    const preview = document.getElementById('settingsAvatarPreview');
    if (preview) {
        preview.innerHTML = avatarMarkup(src.avatar, initials(displayName || state.user.username));
        preview.classList.toggle('has-image', !!src.avatar);
    }
    const removeBtn = document.getElementById('removeAvatarBtn');
    if (removeBtn) removeBtn.style.display = src.avatar ? '' : 'none';

    const nameInput = document.getElementById('profileDisplayName');
    if (nameInput) nameInput.value = displayName;
    const phoneInput = document.getElementById('profilePhone');
    if (phoneInput) phoneInput.value = src.phone || '';
    const bioInput = document.getElementById('profileBio');
    if (bioInput) bioInput.value = src.bio || '';
    const usernameInput = document.getElementById('profileUsername');
    if (usernameInput) usernameInput.value = state.user.username || '';

    const emailRow = document.getElementById('profileEmailRow');
    if (emailRow) {
        emailRow.style.display = state.user.email ? '' : 'none';
        if (state.user.email) document.getElementById('profileEmail').value = state.user.email;
    }

    // Theme picker is handled globally by initThemePicker()
}

/* ---------------- PHOTO RESIZE/CROP ---------------- */
function resizeImageToDataURL(file, maxSize = 320, quality = 0.85) {
    return new Promise((resolve, reject) => {
        if (!file.type || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
        if (file.size > 8 * 1024 * 1024) return reject(new Error('Image is too large (max 8MB).'));
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const side = Math.min(img.width, img.height);
                const sx = (img.width - side) / 2;
                const sy = (img.height - side) / 2;
                const canvas = document.createElement('canvas');
                canvas.width = maxSize;
                canvas.height = maxSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('Could not read that image.'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
    });
}

/* ---------------- WIRING ---------------- */
function initSettings() {
    const fileInput = document.getElementById('avatarFileInput');
    const changeBtn = document.getElementById('changeAvatarBtn');
    const removeBtn = document.getElementById('removeAvatarBtn');
    const preview = document.getElementById('settingsAvatarPreview');
    const userAvatarBtn = document.getElementById('userAvatar');

    if (changeBtn && fileInput) changeBtn.addEventListener('click', () => fileInput.click());
    if (preview && fileInput) preview.addEventListener('click', () => fileInput.click());

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await resizeImageToDataURL(file);
                const src = getMyProfileSource();
                if (!src) return;
                src.avatar = dataUrl;
                await persistMyProfile();
                renderSettingsPage();
                refreshTopbarAvatar();
                addAudit('Profile updated', 'Profile photo changed');
                showToast('Profile photo updated.', 'success');
            } catch (err) {
                showToast(err.message || 'Could not update photo.', 'danger');
            }
            fileInput.value = '';
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
            const src = getMyProfileSource();
            if (!src || !src.avatar) return;
            delete src.avatar;
            await persistMyProfile();
            renderSettingsPage();
            refreshTopbarAvatar();
            addAudit('Profile updated', 'Profile photo removed');
            showToast('Profile photo removed.', 'success');
        });
    }

    // Clicking the avatar in the topbar jumps straight to Settings
    if (userAvatarBtn) {
        userAvatarBtn.style.cursor = 'pointer';
        userAvatarBtn.addEventListener('click', () => switchSection('settings'));
    }

    const infoForm = document.getElementById('profileInfoForm');
    if (infoForm) {
        infoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('profileDisplayName').value.trim();
            const phone = document.getElementById('profilePhone').value.trim();
            const bio = document.getElementById('profileBio').value.trim();
            if (!name) return showToast('Display name cannot be empty.', 'danger');

            const src = getMyProfileSource();
            if (!src) return;
            src.displayName = name;
            src.phone = phone;
            src.bio = bio;
            src.updatedAt = Date.now();

            const btn = infoForm.querySelector('button[type="submit"]');
            const original = btn.textContent;
            btn.disabled = true; btn.textContent = 'Saving...';
            await persistMyProfile();
            btn.disabled = false; btn.textContent = original;

            refreshTopbarAvatar();
            addAudit('Profile updated', 'Updated profile information');
            showToast('Profile saved.', 'success');
        });
    }

    const passForm = document.getElementById('changePasswordFormAdmin');
    if (passForm) {
        passForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('newPasswordAdmin').value;
            const confirmPass = document.getElementById('confirmPasswordAdmin').value;
            if (!pass || pass.length < 6) return showToast('Password must be at least 6 characters.', 'danger');
            if (pass !== confirmPass) return showToast('Passwords do not match.', 'danger');
            if (!isSingletonRole(state.user?.role)) return;

            const btn = passForm.querySelector('button[type="submit"]');
            const original = btn.textContent;
            btn.disabled = true; btn.textContent = 'Updating...';

            const list = await apiListAccounts();
            const account = list && list.success ? list.accounts.find(a => a.role === state.user.role) : null;
            const result = await apiUpdateAccount({
                role: state.user.role,
                username: account?.username || state.user.username,
                password: pass,
                googleEmail: account?.googleEmail || ''
            });
            if (!result || !result.success) {
                showToast((result && result.message) || 'Could not update password.', 'danger');
            } else {
                addAudit('Password changed', `${state.user.role} changed their own password`);
                showToast('Password updated. Use it next time you sign in.', 'success');
                passForm.reset();
            }

            btn.disabled = false; btn.textContent = original;
        });
    }

    // Theme is handled by the global theme picker swatches in initThemePicker()
}
