$outPath = "C:\Users\dhavalk\.gemini\antigravity\brain\2234681e-a2a8-41f5-b515-cdb8fb7064ad\Google_Apps_Script.md"
'Here is the complete backend script for your Google Spreadsheet. Copy the entire code block below and replace everything in your `Code.gs` file.

```javascript' | Out-File -FilePath $outPath -Encoding utf8
Get-Content Code.gs | Out-File -FilePath $outPath -Append -Encoding utf8
'```' | Out-File -FilePath $outPath -Append -Encoding utf8
