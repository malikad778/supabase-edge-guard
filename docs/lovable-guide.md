# Using supabase-edge-guard with Lovable

Lovable projects are Vite SPAs: every file under `src/` ships to the browser, and server logic lives in `supabase/functions`.

```bash
npx supabase-edge-guard --format lovable-prompt
```

Paste the output into Lovable's chat. It lists each issue with file, line and the exact fix (for example the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` migration for SG010) and asks Lovable to list every file it changed.
Re-run the scan after Lovable applies the changes; the score and grade tell you what is left. `--format html -o report.html` produces a shareable report with a copy-prompt button.
