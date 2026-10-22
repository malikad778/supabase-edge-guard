# Supabase Edge Guard Documentation

Welcome to the documentation for **`supabase-edge-guard`**, a cross-boundary static security analyzer for apps built on **Supabase** with **Next.js**, **TanStack Start**, or **Lovable (Vite)**.

It correlates your TypeScript code against your SQL migrations (`supabase/migrations/*.sql`) to catch auth spoofing, RLS bypasses, exposed `SECURITY DEFINER` functions, leaking service role keys, and insecure policies *before* you deploy.

---

## Table of Contents

- [Architecture Overview](architecture.md) — How the tokenizer, boundary detection, import graph, and cross-layer analysis work.
- [Rule Reference](rules/SG001.md) — Comprehensive guide to all 18 security rules (`SG001`–`SG018`) and parse errors (`SG000`).
- [Suppressions and Baselines](suppressing.md) — How to suppress false positives safely and adopt the tool on legacy projects.
- [Continuous Integration (CI)](ci.md) — Setting up GitHub Actions, SARIF reporting, sticky PR comments, and pre-commit hooks.
- [Lovable & Cursor Guide](lovable-guide.md) — How to use `--format lovable-prompt` to fix issues with AI code assistants.
- [Writing Rules](writing-rules.md) — Step-by-step tutorial on implementing and testing new rules.
- [False Positive Policy](false-positives.md) — Our philosophy on precision, heuristics, and reporting.
- [State of Supabase Security](state-of-supabase-security.md) — Benchmarking public Supabase projects.

---

## Core Features

- **Cross-boundary verification:** Verifies TypeScript RPC calls against SQL definitions and storage access against `storage.objects` policies.
- **Zero network calls:** 100% offline, local analysis. No credentials, tokens, or telemetry leave your machine.
- **Fast:** Analyzes 1,000 TypeScript files and 200 migrations in under a second.
- **Automated fixes:** `--fix` applies verified safe code replacements and bundles SQL remediation into a single reviewable migration file.
- **Multi-format reporting:** Supports terminal (`pretty`), `json`, `sarif` 2.1.0, `github` annotations, `markdown` PR comments, `html`, `lovable-prompt`, and `badge` JSON.
- **Model Context Protocol (MCP):** Run `supabase-edge-guard mcp` to integrate directly as an analysis tool in Cursor, Claude Code, or Windsurf.

---

## Quick Navigation

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | Pipeline stages, SQL masking, AST processing |
| [ci.md](ci.md) | GitHub Actions, SARIF upload, security gating |
| [suppressing.md](suppressing.md) | Inline comments, mandatory reasons, `.edge-guard-baseline.json` |
| [writing-rules.md](writing-rules.md) | Scaffolding rules with `pnpm new-rule`, testing guidelines |
| [lovable-guide.md](lovable-guide.md) | Prompt-based auto-remediation for Vite + Supabase apps |
