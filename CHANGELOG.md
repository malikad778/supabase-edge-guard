# Changelog

## 0.2.1
- Added Packagist/Composer support (composer.json and PHP binary wrapper bin/supabase-edge-guard).
- Fixed cross-platform CI/CD and release workflow automation.
- Published interactive demo scanner on GitHub Pages.

## 0.2.0
- All 18 rules (SG001–SG018) plus scanner diagnostics (SG000).
- Cross-layer rules: SG004 (RPC ↔ SECURITY DEFINER ↔ grants), SG008 (storage calls ↔ `storage.objects` policies), SG003 (client-reachable secrets via import graph).
- Output formats: pretty, json, sarif (validated against the official 2.1.0 schema), github, markdown, html, lovable-prompt, badge.
- Fix engine: safe/unsafe fixes, one merged migration, dry-run diffs, dirty-tree guard, re-scan summary.
- Baselines, `--changed-only`, mandatory-reason suppressions, config schema (`schema.json`).
- MCP server (`scan_project`, `explain_finding`, `suggest_fix`), GitHub Action with sticky PR comment.
- Scanner skips files over 1 MB and vendored directories (`.yarn`, `.pnpm-store`, …).

## 0.1.0
- Initial core: SQL tokenizer/parsers, TypeScript boundary classification, rules SG001, SG002, SG003, SG005, SG010 and the pretty/JSON reporters.
