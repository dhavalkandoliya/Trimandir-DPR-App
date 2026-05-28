$content = Get-Content -Raw "app\page.js"

$newCode = @'
        let _usersCache = [SUPER_ADMIN];

        // Ensure we load users asynchronously instead of from localStorage
        async function fetchUsersFromCloud() {
           try {
              const r = await fetch(SHEET_URL + "?action=getUsers");
              const d = await r.json();
              if(Array.isArray(d) && d.length > 0) _usersCache = [SUPER_ADMIN, ...d];
           } catch(e){}
           renderLoginChips();
           if(document.getElementById('adminTabBtn').style.display === 'block') renderAdminUsers();
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

            if (!username || !password) { showToast('⚠️ Username and Password required'); return; }
            if (_usersCache.find(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('⚠️ Username exists'); return; }

            showToast('⏳ Creating User in Cloud...');
            const payload = { action: 'createUser', username, displayName: displayName || username, password, role };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            document.getElementById('newUsername').value = ''; document.getElementById('newDisplayName').value = ''; document.getElementById('newPassword').value = '';
            showToast('✅ User created on network!');
        }

        async function deleteUser(username) {
            if (username === SUPER_ADMIN.username) return;
            if (!confirm(`Delete user "${username}"?`)) return;

            showToast('⏳ Deleting User...');
            const payload = { action: 'deleteUser', username };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            showToast('🗑️ User deleted across network');
        }

        async function resetPassword(username) {
            const newPass = prompt(`Set new password for "${username}":`);
            if (!newPass || !newPass.trim()) return;

            showToast('⏳ Updating network password...');
            const payload = { action: 'resetPassword', username, password: newPass.trim() };
            await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            showToast('✅ Password changed instantly on network');
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

# Replace the block from `function getUsers()` up to `/* ══ ACTIVITIES ══ */`
$regex = '(?s)function getUsers\(\).*?function renderAdminUsers\(\) \{.*?\n\s*\}\n'
$content = [regex]::Replace($content, $regex, "$newCode`n`n")

# Hook fetchUsersFromCloud into Window.onload 
$hookRegex = '(?s)try \{\s*const s = sessionStorage.getItem\(''dprUser''\);'
$hookCode = "fetchUsersFromCloud();`n      try {`n          const s = sessionStorage.getItem('dprUser');"
$content = $content -replace [regex]::Escape("try {`n          const s = sessionStorage.getItem('dprUser');"), "fetchUsersFromCloud();`n      try {`n          const s = sessionStorage.getItem('dprUser');"

Set-Content -Path "app\page.js" -Value $content -Encoding UTF8
Write-Output "Users block replaced!"
