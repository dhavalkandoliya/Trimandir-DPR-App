$content = Get-Content -Raw "index.html"
$bodyMatch = [regex]::Match($content, '(?s)<body>(.*?)<script>')
$bodyHtml = if ($bodyMatch.Success) { $bodyMatch.Groups[1].Value.Trim() } else { "<div>No body found</div>" }
$bodyHtml = $bodyHtml.Replace('`', '\`').Replace('$', '\$')

$scriptMatch = [regex]::Match($content, '(?s)<script>(.*?)</script>')
$scriptJs = if ($scriptMatch.Success) { $scriptMatch.Groups[1].Value.Trim() } else { "" }
$scriptJs = [regex]::Replace($scriptJs, 'const SHEET_URL = "[^"]+";', 'const SHEET_URL = "/api/proxy";')

$funcs = [regex]::Matches($scriptJs, 'function\s+([a-zA-Z0-9_]+)\s*\(')
$assignedFuncs = [System.Collections.Generic.List[string]]::new()
foreach ($f in $funcs) {
    $fn = $f.Groups[1].Value
    if (-not $assignedFuncs.Contains($fn)) {
        $assignedFuncs.Add($fn)
    }
}
if (-not $assignedFuncs.Contains("fetchUsersFromCloud")) {
    $assignedFuncs.Add("fetchUsersFromCloud")
}
$assignList = $assignedFuncs -join ",`n      "

$windowAttachments = @"
    if (typeof window !== "undefined") {
        Object.assign(window, {
      $assignList
        });
    }
"@

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

$template1 = @'
'use client';

import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
       const script1 = document.createElement('script');
       script1.src = "https://html2canvas.hertzen.com/dist/html2canvas.min.js";
       document.head.appendChild(script1);
       
       const script2 = document.createElement('script');
       script2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
       document.head.appendChild(script2);
    }
'@

$template2 = @'
    setTimeout(() => {
      fetchUsersFromCloud();
      try {
          const s = sessionStorage.getItem('dprUser');
          if (s) { _currentUser = JSON.parse(s); showApp(); }
      } catch (e) { }
    }, 500);

  }, []);

  return <div dangerouslySetInnerHTML={{ __html: `
'@

$template3 = @'
` }} />;
}
'@

$finalJsx = $template1 + "`n" + $scriptJs + "`n" + $windowAttachments + "`n" + $template2 + $bodyHtml + $template3

[System.IO.File]::WriteAllText("$(Get-Location)\app\page.js", $finalJsx)
Write-Output "Successfully generated final page.js"
