# Supabase Edge Guard

[![CI](https://github.com/malikad778/supabase-edge-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/malikad778/supabase-edge-guard/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/supabase-edge-guard?color=3ecf8e&logo=npm)](https://www.npmjs.com/package/supabase-edge-guard)
[![Packagist Version](https://img.shields.io/packagist/v/malikad778/supabase-edge-guard?color=f28d1a&logo=packagist)](https://packagist.org/packages/malikad778/supabase-edge-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=18.17](https://img.shields.io/badge/Node->=18.17-brightgreen.svg)](https://nodejs.org)
[![SARIF 2.1.0](https://img.shields.io/badge/SARIF-2.1.0-orange.svg)](https://docs.github.com/en/code-security/code-scanning)
[![Security Score](https://img.shields.io/badge/Security_Score-A%2B-3ecf8e.svg)](#security-scoring)
[![GitHub Action](https://img.shields.io/badge/GitHub_Action-v0-blue?logo=githubactions)](action.yml)

Cross-boundary static security analyzer and Row Level Security (RLS) auditor for apps built on **Supabase** with **Next.js**, **TanStack Start**, or **Lovable (Vite)**.

It correlates your **TypeScript abstract syntax tree (AST)** and your **SQL migrations (`supabase/migrations/*.sql`)** together. This catches critical vulnerabilities that single-language linters cannot see:
- A browser `supabase.rpc()` call invoking a `SECURITY DEFINER` function with public execute privileges.
- A `service_role` secret key leaking into client JavaScript bundles through an import graph chain.
- Server-side authentication trusting `supabase.auth.getSession()` unverified cookie headers instead of `getUser()`.
- Public database tables created without enabling Row Level Security (RLS).
- Storage bucket upload calls lacking user-ownership constraints on `storage.objects`.

---

## Highlights

- **100% Local and Offline:** Zero network requests, zero telemetry, no database connection needed. Your private code and schema never leave your workstation.
- **Ultra Fast:** Audits 1,000 TypeScript files and 200 SQL migrations in under 0.6 seconds.
- **Automated Fix Engine:** `--fix` safely refactors insecure TypeScript patterns and writes clean, reviewed SQL remediation migrations.
- **AI Prompt Generator:** `--format lovable-prompt` prints copy-paste instructions tailored for **Lovable**, **Cursor**, and **v0** vibe-coders.
- **Enterprise CI / CD Integration:** Native SARIF 2.1.0 output for GitHub Code Scanning alerts tab, sticky PR comments, baseline drift protection, and Husky pre-commit hooks.
- **Model Context Protocol (MCP) Server:** Seamless integration as a security analysis tool for Cursor, Claude Code, and Windsurf.

---

## Quick Start

Run instantly without installation via `npx`:

```bash
# Scan the current project directory (Node.js)
npx supabase-edge-guard

# Or install and run via Composer (PHP / Packagist)
composer require malikad778/supabase-edge-guard
./vendor/bin/supabase-edge-guard

# Preview automated security fixes without modifying files
npx supabase-edge-guard --fix --dry-run

# Apply verified safe fixes (clean git working tree required)
npx supabase-edge-guard --fix

# Generate project config, GitHub Action workflow, and pre-commit hook
npx supabase-edge-guard init

# Output a paste-ready remediation prompt for Lovable or Cursor
npx supabase-edge-guard --format lovable-prompt
```

### CLI Exit Codes

- `0`: Clean scan with zero findings at or above `--fail-on` (default: `error`).
- `1`: Security vulnerabilities detected at or above the threshold.
- `2`: Configuration error, invalid CLI flags, or file system error.

### Terminal Output Preview

```
 supabase-edge-guard v0.2.1 - Next.js (app router) · 12 TS files · 1 migration

 ✖ error   SG010  Table public.orders has no Row Level Security, so anyone with the anon key can read and write every row through the REST API.
    supabase/migrations/20240101000000_init.sql:3:1
       3 │ create table public.orders (
    fix available → run with --fix
    https://github.com/malikad778/supabase-edge-guard/blob/main/docs/rules/SG010.md

 ✖ error   SG001  auth.getSession() trusts an unverified cookie in server code, so the user identity can be forged; use auth.getUser() (or getClaims()) instead.
    middleware.ts:13:13
      13 │ } = await supabase.auth.getSession();
    fix available → run with --fix
    https://github.com/malikad778/supabase-edge-guard/blob/main/docs/rules/SG001.md

 Score 0/100 (F) · 11 errors · 11 warnings · 3 info
 Next: npx supabase-edge-guard --fix  (10 findings auto-fixable)
```

---

## Why Cross-Boundary Analysis?

Single-layer linters fail to catch full-stack Supabase vulnerabilities because code and database permissions live on opposite sides of the application boundary:

| Security Vector | ESLint | pgrls / SQL Linter | Supabase Edge Guard |
|---|:---:|:---:|:---:|
| **TS calls RPC targeting public SECURITY DEFINER** | Cannot read SQL | Cannot read TS | **Catches both & verifies execute grants (SG004)** |
| **`service_role` key bundled into browser JS** | Misses import graph | Cannot read TS | **Traces client bundle reachability (SG003)** |
| **Server-side `auth.getSession()` cookie spoofing** | Unaware of Supabase | Cannot read TS | **Classifies boundary & provides safe fix (SG001)** |
| **Storage `.upload()` without bucket policy** | Cannot inspect storage policies | Cannot read TS calls | **Cross-checks bucket policies & write calls (SG008)** |
| **Tables created without Row Level Security** | Cannot read SQL | Flags SQL only | **Flags SQL & writes remediation migration (SG010)** |
| **Unindexed foreign keys in RLS queries** | Cannot read SQL | Flags SQL only | **Calculates impact & auto-indexes columns (SG007)** |
| **Unguarded server-side LLM streaming endpoints** | Misses AI patterns | Cannot read TS | **Verifies timeouts, maxDuration & rate limits (SG018)** |

---

## Security Rules

`supabase-edge-guard` ships with 18 high-precision rules covering TypeScript, SQL migrations, cross-boundary calls, and project configuration:

<!-- RULES:START -->
| ID | Name | Severity | Layer | Fix | What it catches |
|----|------|----------|-------|-----|-----------------|
| [SG001](docs/rules/SG001.md) | ServerAuthGetSessionSpoof | error | ts | safe | auth.getSession() used for authentication in server, edge or middleware code. |
| [SG002](docs/rules/SG002.md) | ServiceRoleWithoutAuthCheck | error | ts | none | service_role client used on user-controlled input or without verifying the caller first. |
| [SG003](docs/rules/SG003.md) | ServiceRoleInClientBundle | error | cross | none | service_role key referenced from code that is bundled for the browser. |
| [SG004](docs/rules/SG004.md) | SecurityDefinerRpcExposed | error | cross | safe | supabase.rpc() calls a SECURITY DEFINER function that is callable by anon/public and does not check auth.uid(). |
| [SG005](docs/rules/SG005.md) | RlsPolicyAuthUidNotWrapped | warning | sql | safe | auth.uid()/jwt()/role()/email() in an RLS policy is not wrapped in (select ...). |
| [SG006](docs/rules/SG006.md) | OverlyPermissivePolicy | error | sql | none | Policy that is effectively 'allow everyone': auth.uid() IS NULL OR ..., or USING (true) on writes. |
| [SG007](docs/rules/SG007.md) | MissingIndexOnPolicyOrFkColumn | warning | sql | safe | Foreign-key column or column used in an RLS policy has no index. |
| [SG008](docs/rules/SG008.md) | StorageWriteUnprotected | error | cross | none | Storage bucket written from the browser without an owner-scoped storage.objects policy (or public bucket writable by anon). |
| [SG009](docs/rules/SG009.md) | SharedClientSessionLeak | error | ts | none | A module-scope Supabase client has its session/auth mutated per request on the server. |
| [SG010](docs/rules/SG010.md) | TableWithoutRls | error | sql | safe | Table in an exposed schema never has ROW LEVEL SECURITY enabled. |
| [SG011](docs/rules/SG011.md) | RlsEnabledWithoutPolicies | info | sql | none | RLS is enabled but the table has no policies, so every client request is denied. |
| [SG012](docs/rules/SG012.md) | PolicyTrustsUserMetadata | error | sql | none | RLS policy reads user_metadata / raw_user_meta_data, which users can edit themselves. |
| [SG013](docs/rules/SG013.md) | SecurityDefinerWithoutSearchPath | warning | sql | unsafe | SECURITY DEFINER function without SET search_path. |
| [SG014](docs/rules/SG014.md) | ViewBypassesRls | warning | sql | unsafe | View over an RLS-protected table is not security_invoker, so it bypasses the table policies. |
| [SG015](docs/rules/SG015.md) | UpdatePolicyWithoutWithCheck | warning | sql | none | UPDATE/ALL policy has USING but no explicit WITH CHECK on an ownership column. |
| [SG016](docs/rules/SG016.md) | EdgeFunctionVerifyJwtDisabled | warning | config | none | Edge function has verify_jwt = false and no Authorization / webhook-signature check in its code. |
| [SG017](docs/rules/SG017.md) | PublicEnvSecretOrUnignoredEnv | error | config | none | Secret-looking variable with a public prefix (NEXT_PUBLIC_/VITE_/PUBLIC_), or .env files not git-ignored. |
| [SG018](docs/rules/SG018.md) | LlmCallWithoutLimits | warning | ts | none | Server-side LLM call with no timeout, max duration or rate limit in the same file. |
<!-- RULES:END -->

Run `npx supabase-edge-guard explain SG001` in your terminal to see the production incident, bad code example, and good code solution, or browse [docs/rules/](docs/rules/).

---

## Output Formats

Select any format via `--format <name>` and write to a file with `-o <path>`:

| Format | Target Use Case |
|---|---|
| `pretty` | Terminal default with clean colors, file snippets, and links. Respects `NO_COLOR`. |
| `json` | Structured JSON containing scores, grades, metrics, and exact text fixes. |
| `sarif` | SARIF 2.1.0 standard format for GitHub Code Scanning (Security tab). |
| `github` | Workflow step annotations (`::error file=...,line=...::message`). |
| `markdown` | Sticky GitHub PR summary comment with expandable failure breakdown. |
| `html` | Self-contained, responsive report with dark mode, severity filters, and copy prompt. |
| `lovable-prompt` | Ready-to-paste prompt for AI coding assistants (Lovable, Cursor, Windsurf, v0). |
| `badge` | Shields.io endpoint JSON format (`label`, `message`, `color`). |

---

## Automated Remediation (`--fix`)

Run `npx supabase-edge-guard --fix` to automatically repair security flaws:
- Safe code fixes (`SG001`, `SG004`, `SG005`, `SG007`, `SG010`) apply directly to source files.
- SQL policy and table remediations are consolidated into **one** reviewable migration file:
  `supabase/migrations/YYYYMMDDHHMMSS_edge_guard_fixes.sql`.
- Unsafe fixes that could modify application behavior (`SG013`, `SG014`) require explicit `--unsafe` opt-in.
- Dry run preview: `--fix --dry-run` displays unified terminal diffs without modifying files.

---

## Lovable and Cursor AI Prompt Mode

When using AI code generators like Lovable, v0, or Cursor, run:

```bash
npx supabase-edge-guard --format lovable-prompt
```

The output gives the AI precise, numbered instructions specifying exact file paths, line numbers, and SQL statements:

```
You are fixing security issues in my Supabase app. Apply ALL changes below. Do not change anything else.
1. [SG010] In supabase/migrations/001_init.sql the table public.orders has no RLS. Add a new migration that runs: ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY; and add policies so users can only access rows where user_id = (select auth.uid()).
2. [SG001] In app/actions/profile.ts line 12, replace supabase.auth.getSession() with supabase.auth.getUser() and use data.user.
...
After applying, list every file you changed.
```

---

## Configuration

Customize behavior in `supabase-edge-guard.config.json` (or `.supabase-edge-guardrc.json`, or `"edgeGuard"` key in `package.json`):

```json
{
  "$schema": "https://raw.githubusercontent.com/malikad778/supabase-edge-guard/main/schema.json",
  "include": ["**/*"],
  "exclude": ["**/*.test.*", "**/dist/**", "**/.next/**"],
  "migrationsDir": "supabase/migrations",
  "functionsDir": "supabase/functions",
  "rules": {
    "SG011": "off",
    "SG005": "info"
  },
  "ignoreTables": ["public.schema_migrations"],
  "exposedSchemas": ["public"],
  "failOn": "error"
}
```

---

## Suppressions and Baselines

### Inline Suppressions

To suppress a false positive on the next line:

```ts
// edge-guard-disable-next-line SG001 -- session read for user locale preference only, not authorization
const { data: { session } } = await supabase.auth.getSession();
```

In SQL migrations:

```sql
-- edge-guard-disable-next-line SG010 -- public lookup table with static zip codes
CREATE TABLE public.zip_codes ( code text primary key, city text not null );
```

A written explanation following `--` is **mandatory**. Comments without a reason are ignored and reported as `SG000`.

### Legacy Baselines

To adopt `supabase-edge-guard` on existing projects without blocking ongoing feature development:

```bash
# Capture current issues into .edge-guard-baseline.json
npx supabase-edge-guard baseline

# Future scans only report new issues introduced after baseline
npx supabase-edge-guard
```

Baseline entries are fingerprinted using SHA-1 snippet hashes rather than volatile line numbers.

---

## Continuous Integration (GitHub Action)

Add `supabase-edge-guard` to your GitHub repository in 5 lines:

```yaml
# .github/workflows/edge-guard.yml
name: Security Audit
on: [pull_request, push]

permissions:
  contents: read
  security-events: write
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: malikad778/supabase-edge-guard@v0
        with:
          fail-on: error
          upload-sarif: 'true'
          comment: 'true'
```

---

## Model Context Protocol (MCP) Server

Connect `supabase-edge-guard` as a persistent security agent in Cursor, Claude Code, or Windsurf.

Run `npx supabase-edge-guard mcp` over stdio.

Add to your `cursor.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supabase-edge-guard": {
      "command": "npx",
      "args": ["-y", "supabase-edge-guard", "mcp"]
    }
  }
}
```

Exposed MCP tools:
- `scan_project`: Audits the workspace and returns structured vulnerabilities and grade.
- `explain_finding`: Returns incident context, vulnerable code, and recommended remediation.
- `suggest_fix`: Returns code replacements or SQL migration text for a specific finding.

---

## Security Scoring

Each project receives an overall security grade from **A+** to **F**:

$$\text{Score} = \max\Big(0, \, 100 - (10 \times \text{errors}) - (3 \times \text{warnings}) - (1 \times \text{infos})\Big)$$

- **A+ / A:** Score 90 to 100 (production deployable)
- **B:** Score 80 to 89
- **C:** Score 70 to 79
- **D:** Score 50 to 69
- **F:** Score below 50 (critical RLS or auth bypasses detected)

Generate a dynamic README badge with:
```bash
npx supabase-edge-guard --format badge -o badge.json
```

---

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Rule Directory](docs/rules/SG001.md)
- [Suppressions and Baselines](docs/suppressing.md)
- [CI / CD Setup](docs/ci.md)
- [Lovable & Cursor Guide](docs/lovable-guide.md)
- [Writing a Custom Rule](docs/writing-a-rule.md)
- [False Positive Policy](docs/false-positives.md)
- [State of Supabase Security](docs/state-of-supabase-security.md)

---

## Development

```bash
# Install dependencies
pnpm install

# Build CLI and library bundles
pnpm build

# Run test suite
pnpm test

# Lint and typecheck
pnpm lint && pnpm typecheck

# Scaffold a new security rule
pnpm new-rule SG019 NewRuleName ts

# Regenerate rule pages, README table, and schema
pnpm gen-docs
```

---

## License

MIT © [Malik Adnan Haider Awan](https://github.com/malikad778)
