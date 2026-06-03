# ─── FORCE UTF-8 OUTPUT MODE — prevents emoji/dash corruption ────────────────
[Console]::OutputEncoding   = [System.Text.Encoding]::UTF8
$OutputEncoding             = [System.Text.Encoding]::UTF8

# ─── UTF-8 helper (no BOM) ───────────────────────────────────────────────────
$utf8 = New-Object System.Text.UTF8Encoding($false)

# ─── READ index.html as raw UTF-8 bytes (bypasses ANSI code-page entirely) ───
$rawBytes = [System.IO.File]::ReadAllBytes("$(Get-Location)\index.html")
$raw      = $utf8.GetString($rawBytes)

# ─── EXTRACT <body> HTML and <script> JS ─────────────────────────────────────
$bodyMatch = [regex]::Match($raw, '(?s)<body>(.*?)<script>')
$bodyHtml  = if ($bodyMatch.Success) { $bodyMatch.Groups[1].Value.Trim() } else { '<div>No body found</div>' }

$scriptMatch = [regex]::Match($raw, '(?s)<script>(.*?)</script>')
$scriptJs    = if ($scriptMatch.Success) { $scriptMatch.Groups[1].Value.Trim() } else { '' }

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
             const username    = document.getElementById('newUsername').value.trim();
             const displayName = document.getElementById('newDisplayName').value.trim();
             const password    = document.getElementById('newPassword').value.trim();
             const role        = document.getElementById('newRole').value;
             if (!username || !password) { showToast('Username and Password required'); return; }
             if (_usersCache.find(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('Username exists'); return; }
             showToast('Creating User in Cloud...');
             const payload = { action: 'createUser', username, displayName: displayName || username, password, role };
             await fetch(SHEET_URL, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
             await fetchUsersFromCloud();
             document.getElementById('newUsername').value = '';
             document.getElementById('newDisplayName').value = '';
             document.getElementById('newPassword').value = '';
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
$scriptJs = [regex]::Replace($scriptJs, '(?s)function getUsers\(\).*?function renderAdminUsers\(\) \{.*?\n\s*\}\n', $newUsersLogic)

# ─── EXTRACT FUNCTION NAMES TO BIND TO WINDOW ───────────────────────────────
$funcs = [regex]::Matches($scriptJs, '(?m)^[ \t]*(?:async\s+)?function\s+([a-zA-Z0-9_]+)')
$windowAttachments = ""
foreach ($f in $funcs) {
    $fn = $f.Groups[1].Value
    if ($fn) {
        $windowAttachments += "`n    window.$fn = $fn;"
    }
}

# ─── ESCAPE HTML FOR BACKTICK EMBEDDING ──────────────────────────────────────
$escapedHtml = $bodyHtml.Replace('`', '\`').Replace('$', '\$')

# ─── BUILD app/page.js BY CONCATENATION ──────────────────────────────────────
$part1 = "'use client';" + "`n" +
          "" + "`n" +
          "import { useEffect } from 'react';" + "`n" +
          "" + "`n" +
          "export default function Page() {" + "`n" +
          "  useEffect(() => {" + "`n" +
          "    if (typeof window === 'undefined') return;" + "`n" +
          "" + "`n" +
          "    // -- Inject html2canvas and jsPDF from CDN --" + "`n" +
          "    const s1 = document.createElement('script');" + "`n" +
          "    s1.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';" + "`n" +
          "    document.head.appendChild(s1);" + "`n" +
          "" + "`n" +
          "    const s2 = document.createElement('script');" + "`n" +
          "    s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';" + "`n" +
          "    document.head.appendChild(s2);" + "`n"

$part2 = "" + "`n" +
          "    // -- Attach functions to window --" + "`n" +
          $windowAttachments + "`n" +
          "" + "`n" +
          "    // -- Bootstrap: restore session and fetch users --" + "`n" +
          "    setTimeout(() => {" + "`n" +
          "      if (typeof fetchUsersFromCloud === 'function') fetchUsersFromCloud();" + "`n" +
          "      try {" + "`n" +
          "        const s = sessionStorage.getItem('dprUser');" + "`n" +
          "        if (s && typeof showApp === 'function') {" + "`n" +
          "          window._currentUser = JSON.parse(s);" + "`n" +
          "          showApp();" + "`n" +
          "        }" + "`n" +
          "      } catch (e) {}" + "`n" +
          "    }, 600);" + "`n" +
          "" + "`n" +
          "  }, []);" + "`n" +
          "" + "`n" +
          "  return <div dangerouslySetInnerHTML={{ __html: " + [char]96

$part3 = [char]96 + " }} />;" + "`n" +
          "}" + "`n"

# Concatenate everything
$pageJs = $part1 + $scriptJs + $part2 + $escapedHtml + $part3

# ─── WRITE as strict UTF-8 (no BOM) ──────────────────────────────────────────
[System.IO.File]::WriteAllText("$(Get-Location)\app\page.js", $pageJs, $utf8)
Write-Output "Successfully generated final page.js via dangerouslySetInnerHTML"
