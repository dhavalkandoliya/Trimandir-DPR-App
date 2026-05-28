import re

with open("c:\\Users\\dhavalk\\Downloads\\TPD-DPR-App\\index.html", "r", encoding="utf-8") as f:
    content = f.read()

# Extract Body without script and style
body_match = re.search(r'<body>(.*?)<script>', content, re.DOTALL)
if body_match:
    body_html = body_match.group(1).strip()
else:
    body_html = "<div>No body found</div>"

# Escape backticks
body_html = body_html.replace('`', '\\`').replace('$', '\\$')

# Extract Script
script_match = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
if script_match:
    script_js = script_match.group(1).strip()
else:
    script_js = ""

# Update SHEET_URL securely to proxy
script_js = re.sub(r'const SHEET_URL = "[^"]+";', 'const SHEET_URL = "/api/proxy";', script_js)

# Find all function names defined in the script so we can attach them to window
# e.g., function doLogin(), function switchTab(tab, btn)
functions = re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', script_js)

window_attachments = "\n    ".join([f"window.{fn} = {fn};" for fn in functions])

jsx_code = f"""'use client';

import {{ useEffect }} from 'react';

export default function Page() {{
  useEffect(() => {{
    // Global references for html2canvas and jspdf to prevent SSR crash
    if (typeof window !== 'undefined') {{
       const script1 = document.createElement('script');
       script1.src = "https://html2canvas.hertzen.com/dist/html2canvas.min.js";
       document.head.appendChild(script1);
       
       const script2 = document.createElement('script');
       script2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
       document.head.appendChild(script2);
    }}

    {script_js}

    // Attach to window so inline onclick handlers work
    {window_attachments}

    // Call init manually since load event is already fired
    setTimeout(() => {{
      if(typeof renderLoginChips === 'function') renderLoginChips();
      try {{
          const s = sessionStorage.getItem('dprUser');
          if (s) {{ _currentUser = JSON.parse(s); showApp(); }}
      }} catch (e) {{ }}

      const dElem = document.getElementById('date');
      if (dElem) dElem.value = new Date().toISOString().split('T')[0];
    }}, 500);

  }}, []);

  return <div dangerouslySetInnerHTML={{{{ __html: `{body_html}` }}}} />;
}}
"""

with open("c:\\Users\\dhavalk\\Downloads\\TPD-DPR-App\\app\\page.js", "w", encoding="utf-8") as f:
    f.write(jsx_code)

print("Safely converted index.html to app/page.js")
