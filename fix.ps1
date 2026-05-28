$lines = Get-Content -Path "app\page.js"

$newCode = @'
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

        function saveUsers(list) {}
        
        async function createUser() {
            const username = document.getElementById('newUsername').value.trim();
            const displayName = document.getElementById('newDisplayName').value.trim();
            const password = document.getElementById('newPassword').value.trim();
            const role = document.getElementById('newRole').value;

            if (!username || !password) { showToast('Username and Password required'); return; }
            if (_usersCache.find(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('Username exists'); return; }

            showToast('Creating User in Cloud...');
            const payload = { action: 'createUser', username, displayName: displayName || username, password, role };
            await fetch(SHEET_URL, { method: 'POST', body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            document.getElementById('newUsername').value = ''; document.getElementById('newDisplayName').value = ''; document.getElementById('newPassword').value = '';
            showToast('User created on network!');
        }

        async function deleteUser(username) {
            if (username === SUPER_ADMIN.username) return;
            if (!confirm(`Delete user "${username}"?`)) return;

            showToast('Deleting User...');
            const payload = { action: 'deleteUser', username };
            await fetch(SHEET_URL, { method: 'POST', body: JSON.stringify(payload) });
            
            await fetchUsersFromCloud();
            showToast('User deleted across network');
        }

        async function resetPassword(username) {
            const newPass = prompt(`Set new password for "${username}":`);
            if (!newPass || !newPass.trim()) return;

            showToast('Updating network password...');
            const payload = { action: 'resetPassword', username, password: newPass.trim() };
            await fetch(SHEET_URL, { method: 'POST', body: JSON.stringify(payload) });
            
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

# Find start line: "function getUsers() {"
$startIdx = -1
for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match "^\s*function getUsers\(\) \{") {
        $startIdx = $i
        break
    }
}

# Find end line: end of renderAdminUsers (right before /* ══ ACTIVITIES ══ */)
$endIdx = -1
for ($i = $startIdx; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match ".*ACTIVITIES.*") {
        $endIdx = $i - 1 # the empty line or bracket before it
        break
    }
}

# Overwrite array
$head = $lines[0..($startIdx - 1)]
$tail = $lines[($endIdx + 1)..($lines.Length - 1)]

# Now we must ensure window hook for fetchUsersFromCloud exists
$newTail = @()
foreach ($line in $tail) {
    if ($line -match "if\(typeof renderLoginChips === 'function'\) renderLoginChips\(\);") {
        $newTail += "      fetchUsersFromCloud();"
    } elseif ($line -match "setTimeout\(\(\) => \{") {
        $newTail += "    window.fetchUsersFromCloud = fetchUsersFromCloud;"
        $newTail += $line
    } else {
        $newTail += $line
    }
}

$finalLines = $head + $newCode + $newTail
[System.IO.File]::WriteAllLines("$(Get-Location)\app\page.js", $finalLines)

Write-Output "Fixed app\page.js perfectly! Starts at $startIdx, Ends at $endIdx."
