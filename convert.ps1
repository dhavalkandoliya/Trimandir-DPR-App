$content = Get-Content -Raw "index.html"
$bodyMatch = [regex]::Match($content, '(?s)<body>(.*?)<script>')
$bodyHtml = if ($bodyMatch.Success) { $bodyMatch.Groups[1].Value.Trim() } else { "<div>No body found</div>" }
$bodyHtml = $bodyHtml.Replace('`', '\`').Replace('$', '\$')

$scriptMatch = [regex]::Match($content, '(?s)<script>(.*?)</script>')
$scriptJs = if ($scriptMatch.Success) { $scriptMatch.Groups[1].Value.Trim() } else { "" }
$scriptJs = [regex]::Replace($scriptJs, 'const SHEET_URL = "[^"]+";', 'const SHEET_URL = "/api/proxy";')

$funcs = [regex]::Matches($scriptJs, 'function\s+([a-zA-Z0-9_]+)\s*\(')
$windowAttachments = ""
foreach ($f in $funcs) {
    $fn = $f.Groups[1].Value
    $windowAttachments += "`n    window.$fn = $fn;"
}

# Use single quotes for exactly literal here-strings
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
      if(typeof renderLoginChips === 'function') renderLoginChips();
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

Set-Content -Path "app\page.js" -Value $finalJsx -Encoding UTF8
Write-Output "Successfully generated app\page.js"
