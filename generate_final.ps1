# ─── PARSE index.html ────────────────────────────────────────────────────────
$raw = Get-Content -Raw "index.html" -Encoding UTF8

# Extract <body> content (everything between <body> and first <script>)
$bodyMatch = [regex]::Match($raw, '(?s)<body>(.*?)<script>')
$bodyHtml  = if ($bodyMatch.Success) { $bodyMatch.Groups[1].Value.Trim() } else { "<div>No body found</div>" }

# Extract <script> content
$scriptMatch = [regex]::Match($raw, '(?s)<script>(.*?)</script>')
$scriptJs    = if ($scriptMatch.Success) { $scriptMatch.Groups[1].Value.Trim() } else { "" }

# ─── PATCH SHEET_URL ─────────────────────────────────────────────────────────
$scriptJs = [regex]::Replace($scriptJs, 'const SHEET_URL = "[^"]+";', 'const SHEET_URL = "/api/proxy";')

# ─── PATCH USER MANAGEMENT to cloud-backed versions ──────────────────────────
$newUsersLogic = @'
        let _usersCache = [SUPER_ADMIN];

        async function fetchUsersFromCloud() {
           try {
              const r = await fetch(SHEET_URL + "?action=getUsers");
              const d = await r.json();
              if(Array.isArray(d)) _usersCache = [SUPER_ADMIN, ...d];
           } catch(e){}
           if(typeof renderLoginChips === 'function') renderLoginChips();
           const adminBtn = document.getElementById('adminTabBtn');
           if(adminBtn && adminBtn.style.display === 'block') {
               if(typeof renderAdminUsers === 'function') renderAdminUsers();
           }
        }

        function getUsers() {
            return _usersCache;
        }

        function saveUsers(list) {
            // Function no longer uses local storage, relies on cloud endpoints
        }
        
        async function createUser() {
            const username = document.getElementById('newUsername').value.trim();
            const displayName = document.getElementById('newDisplayName').value.trim();
            const password = document.getElementById('newPassword').value.trim();
            const role = document.getElementById('newRole').value;

            if (!username || !password) { showToast('Username and Password required'); return; }
            if (_usersCache.find(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('Username exists'); return; }

            showToast('Creating User in Cloud...');
            const payload = { action: 'createUser', username, displayName: displayName || username, password, role };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            document.getElementById('newUsername').value = ''; document.getElementById('newDisplayName').value = ''; document.getElementById('newPassword').value = '';
            showToast('User created on network!');
        }

        async function deleteUser(username) {
            if (username === SUPER_ADMIN.username) return;
            if (!confirm(`Delete user "${username}"?`)) return;

            showToast('Deleting User...');
            const payload = { action: 'deleteUser', username };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            showToast('User deleted across network');
        }

        async function resetPassword(username) {
            const newPass = prompt(`Set new password for "${username}":`);
            if (!newPass || !newPass.trim()) return;

            showToast('Updating network password...');
            const payload = { action: 'resetPassword', username, password: newPass.trim() };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            showToast('Password changed instantly on network');
        }

        function renderAdminUsers() {
            document.getElementById('adminUserList').innerHTML = getUsers().map(u => {
                const isSuper = u.username === SUPER_ADMIN.username;
                return `
      <div class="admin-user-row">
        <div><div class="admin-user-info">👤 ${u.username}</div><div class="admin-user-sub">${u.displayName || ''} &nbsp;·&nbsp; <b>${u.role === 'admin' ? 'Admin' : 'User'}</b></div></div>
        <div style="display:flex;gap:6px;">
          ${!isSuper ? `<button class="btn-gray btn-sm" style="width:auto;padding:5px 10px;" onclick="resetPassword('${u.username}')">🔑 Reset</button>` : ''}
          ${!isSuper ? `<button class="btn-red btn-sm" style="width:auto;padding:5px 10px;" onclick="deleteUser('${u.username}')">🗑️</button>` : '<span style="font-size:11px;color:var(--muted);padding:5px 0;">Protected</span>'}
        </div>
      </div>`;
            }).join('');
        }
'@
$scriptJs = [regex]::Replace($scriptJs, '(?s)function getUsers\(\).*?function renderAdminUsers\(\) \{.*?\n\s*\}\n', "$newUsersLogic`n`n")

# ─── ESCAPE JS FOR JSON EMBEDDING ────────────────────────────────────────────
# We will embed the script as a JSON string so there are NO escaping issues
# with template literals, backticks, or special chars inside JSX.
$escapedJs   = $scriptJs -replace '\\', '\\\\' -replace '"', '\"' -replace "`r`n", '\n' -replace "`n", '\n' -replace "`t", '\t'
$escapedHtml = $bodyHtml -replace '\\', '\\\\' -replace '"', '\"' -replace "`r`n", '\n' -replace "`n", '\n' -replace "`t", '\t'

# ─── GENERATE CLEAN app/page.js ──────────────────────────────────────────────
$pageJs = @"
'use client';

import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── Inject html2canvas and jsPDF from CDN ──
    const s1 = document.createElement('script');
    s1.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
    document.head.appendChild(s1);

    const s2 = document.createElement('script');
    s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    document.head.appendChild(s2);

    // ── Render HTML into container ──
    const container = document.getElementById('__dpr_root__');
    if (container) {
      container.innerHTML = "$escapedHtml";
    }

    // ── Inject all app logic as a live script element ──
    const appScript = document.createElement('script');
    appScript.textContent = "$escapedJs";
    document.body.appendChild(appScript);

    // ── Bootstrap: restore session and fetch users after scripts load ──
    setTimeout(() => {
      if (typeof fetchUsersFromCloud === 'function') fetchUsersFromCloud();
      try {
        const s = sessionStorage.getItem('dprUser');
        if (s && typeof showApp === 'function') {
          window._currentUser = JSON.parse(s);
          showApp();
        }
      } catch (e) {}
    }, 600);

  }, []);

  return <div id="__dpr_root__" />;
}
"@

[System.IO.File]::WriteAllText("$(Get-Location)\app\page.js", $pageJs, [System.Text.Encoding]::UTF8)
Write-Output "Successfully generated final page.js (clean script-injection pattern)"
