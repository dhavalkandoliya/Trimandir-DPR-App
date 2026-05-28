$css = Get-Content -Raw "app/globals.css"
$page = Get-Content -Raw "app/page.js"

# Extract HTML body
# It is between dangerouslySetInnerHTML={{ __html: ` and `}} />;
$htmlRegex = "(?s)dangerouslySetInnerHTML=\{\{\s*__html:\s*`([\s\S]*?)`\}\}\s*/\s*>"
$htmlMatch = [regex]::Match($page, $htmlRegex)
if (-not $htmlMatch.Success) {
    Write-Error "HTML body not found in page.js"
    exit 1
}
$htmlBody = $htmlMatch.Groups[1].Value.Trim()

# Extract JS code block
$jsRegex = "(?s)(/\* ═══════════════════════════════════════════════════════════\s*CONSTANTS[\s\S]*?)Object\.assign\(window"
$jsMatch = [regex]::Match($page, $jsRegex)
if (-not $jsMatch.Success) {
    Write-Error "JS code block not found in page.js"
    exit 1
}
$jsCode = $jsMatch.Groups[1].Value.Trim()

# Replace the API with direct SHEET_URL for index.html
$jsCode = $jsCode.Replace("const API         = '/api/proxy';", 'const SHEET_URL = "https://script.google.com/macros/s/AKfycbzkT7ZMprLvL2ReEYcxcsVIVml_7ev-5BLtLDXXQWf14Ynoo68fm3q6n2oM3VRsFo2N/exec";')
$jsCode = $jsCode.Replace("const apiFetch = (action) => fetch(`${API}?action=${action}`).then(r => r.json());", "const apiFetch = (action) => fetch(`${SHEET_URL}?action=${action}`).then(r => r.json());")
$jsCode = $jsCode.Replace("const apiPost  = (body)   => fetch(API, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());", "const apiPost  = (body)   => fetch(SHEET_URL, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());")

# Add the window.onload initialization
$onloadJs = @'

        /* ══ INIT ══ */
        window.onload = function () {
            renderLoginChips();
            try {
                const s = sessionStorage.getItem('dprUser');
                if (s) { _currentUser = JSON.parse(s); showApp(); }
            } catch (e) { }

            // Set Date cleanly
            const dateEl = document.getElementById('date');
            if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

            window.addEventListener('offline', () => { document.getElementById('offlineBadge').style.display = 'block'; });
            window.addEventListener('online', () => { document.getElementById('offlineBadge').style.display = 'none'; syncOfflineQueue(); });
            if (!navigator.onLine) document.getElementById('offlineBadge').style.display = 'block';
        };

        // Delegate listeners
        document.addEventListener('click', () => {
            if (window.closeAllHistoryDropdowns) {
                window.closeAllHistoryDropdowns();
            }
        });
        
        document.addEventListener('input', (e) => {
            if (!e.target.closest('#tabForm')) return;
            if (e.target.classList.contains('skill') || e.target.classList.contains('unskill')) {
                const row = e.target.closest('.activitybox');
                if (row) {
                    const sk = Math.max(0, Number(row.querySelector('.skill')?.value) || 0);
                    const un = Math.max(0, Number(row.querySelector('.unskill')?.value) || 0);
                    const valEl = row.querySelector('.row-total-val');
                    if (valEl) valEl.textContent = sk + un;
                }
            }
            saveFormDraft();
        });

        document.addEventListener('change', (e) => {
            if (!e.target.closest('#tabForm')) return;
            saveFormDraft();
        });
'@

$jsCode = $jsCode + "`n" + $onloadJs

$indexHtml = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site DPR — Man Power Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Noto+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <style>
$css
    </style>
</head>
<body>
$htmlBody
    <script>
$jsCode
    </script>
</body>
</html>
"@

Set-Content -Path "index.html" -Value $indexHtml -Encoding UTF8
Write-Output "Successfully compiled page.js and globals.css into index.html!"
