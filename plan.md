# supabase-edge-guard - Implementation Plan (`plan.md`)

> Cross-boundary static analyzer for **Next.js / TanStack Start / Lovable (Vite) + Supabase**.
> Reads your **TypeScript AST** and your **`supabase/migrations/*.sql`** together and finds auth spoofing, RLS bypasses, exposed RPCs and slow/leaky policies **before deploy**.

- Package: `supabase-edge-guard` (npm) - run with `npx supabase-edge-guard`
- Repo: `github.com/malikad778/supabase-edge-guard`
- Language: TypeScript (ESM, Node >= 18)
- License: MIT
- Output formats: pretty console, JSON, SARIF, GitHub annotations, Markdown (PR comment), HTML, Lovable/Cursor fix-prompt, badge JSON
- Rules: SG001–SG009 (original) + SG010–SG018 (new). Ship v0.1 with 12 rules, v0.2 with all 18.

---

## 0. RULES FOR THE AI / DEVELOPER IMPLEMENTING THIS FILE

Read this first. Follow exactly.

1. Build in the milestone order in section 17. Never start milestone N+1 until `pnpm test && pnpm typecheck && pnpm lint` pass for N.
2. One file at a time. Each file must export only what section 4 says it exports.
3. Do NOT add dependencies that are not listed in section 3.
4. Every rule needs: `bad/` fixture, `good/` fixture, `expected.json`, a unit test, and `meta.docs` filled in. A rule without these is not done.
5. No `any`. No `// @ts-ignore`. Use `unknown` + narrowing.
6. Never throw on user code. If a file fails to parse, emit an `info` finding `SG000 ParseError` and continue.
7. Never execute or `require` user code. Static analysis only. Never make network calls.
8. All paths in findings are **relative to project root, POSIX style** (`/`), lines/columns are **1-based**.
9. When unsure whether something is a vulnerability, **do not report** (prefer false negatives over false positives at v0.1). A noisy tool dies on day one.
10. Keep each rule file under ~200 lines. Put shared logic in `src/ts/*` or `src/sql/*`.

---

## 1. PRODUCT DEFINITION

### Problem
Founders ship Lovable / Bolt / v0 / Cursor-generated Next.js + Supabase apps. Typical failures:
1. Server code trusts `supabase.auth.getSession()` (unverified cookie JWT).
2. `service_role` client used inside user-facing actions with user-controlled IDs (RLS fully bypassed).
3. `SECURITY DEFINER` functions callable by `anon` via `supabase.rpc()`.
4. Tables with no RLS / leaky policies / slow policies (`auth.uid()` not wrapped).
5. LLM streaming routes with no timeout/rate-limit guard.

### Gap
`pgrls` only reads SQL. ESLint only reads TS. Nothing cross-checks **TS call sites against SQL schema** in one zero-config CLI.

### Target users
Vibe-coders (paste output into Lovable/Cursor), freelance auditors (Upwork "app rescue"), teams (GitHub Action + SARIF).

### Non-goals (v1)
- No live database connection (static only; optional `--db-url` is v2).
- No runtime proxying/pentesting.
- No auto-fix of logic that needs human judgement (marked "unsafe fix", opt-in).

### Success metrics
- `npx supabase-edge-guard` on a fresh Lovable project: first result in **< 3 s**, **0 config**.
- False-positive rate on 20 real open-source Supabase repos: **< 10 %** of findings (measure in M9).
- 1,000 GitHub stars target via launch plan (section 18).

---

## 2. WHAT WAS ADDED TO THE ORIGINAL IDEA (WHY THIS REPO CAN GO BOOM)

| Addition | Why it matters |
| --- | --- |
| **9 more rules (SG010–SG018)** | Original list missed the #1 real-world bug: **tables with RLS never enabled**; plus `user_metadata` in policies, views bypassing RLS, missing `search_path`, missing `WITH CHECK`, `verify_jwt=false`, `NEXT_PUBLIC_` secrets, LLM timeouts (the 4th item in your list had no rule). |
| **`--format lovable-prompt`** | Prints a ready-to-paste prompt: "Fix these N issues in my project: …". Vibe-coders will share this. Unique. |
| **Security score A–F + badge** | Shareable README badge → organic backlinks. |
| **`--fix` with safe/unsafe split** | `--fix` only applies provably-safe edits; `--fix --unsafe` applies risky ones. Trust = adoption. |
| **GitHub Action + PR comment + SARIF** | Shows in Security tab; teams adopt. |
| **MCP server mode (`supabase-edge-guard mcp`)** | Cursor / Claude Code can call the scanner as a tool. Timely and shareable. |
| **Baseline file** | Adopt on legacy repo without fixing 200 issues first. |
| **Inline suppressions with required reason** | Professional, auditable. |
| **`explain SG001`** | Terminal shows incident, bad code, good code. Doubles as docs. |
| **`init` command** | Writes config + CI workflow + pre-commit hook in one command. |
| **Vulnerable demo apps in `examples/`** | Screenshot-able "before/after". Also used as e2e tests. |
| **"State of Supabase Security" report** | Scan top public repos, publish stats. This is the actual viral artifact. |
| **Docs generated from rule metadata** | One source of truth; README rule table never drifts. |
| **Framework auto-detect** | Next App Router, Pages Router, TanStack Start, Lovable (Vite SPA), Remix/SvelteKit (generic). |
| **Safe-pattern suppression** | e.g. `getSession()` followed by `getUser()` in same function is NOT flagged. Low noise. |

---

## 3. TECH STACK (PINNED DECISIONS - DO NOT CHANGE)

| Concern | Choice |
| --- | --- |
| Package manager | `pnpm` |
| Build | `tsup` (ESM + `.d.ts`, target `node18`) |
| Test | `vitest` |
| Lint/format | `eslint` + `typescript-eslint` + `prettier` |
| TS parsing | `ts-morph` (wraps TypeScript compiler API) |
| SQL parsing | **Own tokenizer + statement splitter + regex per statement** (`src/sql`). No native parser in v0.x. Optional upgrade to `libpg-query` in v1. |
| TOML | `smol-toml` |
| CLI | `commander` |
| Colors | `picocolors` |
| Globbing | `fast-glob` |
| Config validation | `zod` |
| MCP | `@modelcontextprotocol/sdk` (only used by `mcp` command, lazy-imported) |
| Diff display | `diff` |

Runtime dependencies: `ts-morph`, `smol-toml`, `commander`, `picocolors`, `fast-glob`, `zod`, `diff`, `@modelcontextprotocol/sdk`.
Dev dependencies: `typescript`, `tsup`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `@types/node`.

---

## 4. REPOSITORY STRUCTURE

```
supabase-edge-guard/
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ tsup.config.ts
├─ vitest.config.ts
├─ eslint.config.js
├─ .prettierrc
├─ .gitignore
├─ action.yml                          # GitHub Action (composite)
├─ LICENSE
├─ README.md
├─ CONTRIBUTING.md                     # "add a rule in 5 steps"
├─ CHANGELOG.md
├─ SECURITY.md
├─ CODE_OF_CONDUCT.md
├─ plan.md                             # this file
├─ bin/
│  └─ supabase-edge-guard.js           # #!/usr/bin/env node  -> import('../dist/cli/main.js')
├─ src/
│  ├─ index.ts                         # public API: scan(), rules, types
│  ├─ cli/
│  │  ├─ main.ts                       # commander setup, exit codes
│  │  └─ commands/
│  │     ├─ scan.ts                    # default command
│  │     ├─ init.ts
│  │     ├─ explain.ts
│  │     ├─ list-rules.ts
│  │     ├─ baseline.ts
│  │     └─ mcp.ts
│  ├─ core/
│  │  ├─ types.ts                      # Finding, Rule, Fix, ProjectContext (section 5)
│  │  ├─ config.ts                     # load + zod-validate config, defaults
│  │  ├─ file-discovery.ts             # fast-glob, ignore node_modules/.next/dist
│  │  ├─ framework-detect.ts           # detectFramework(root)
│  │  ├─ project-context.ts            # builds ProjectContext (ts + sql + config files)
│  │  ├─ scanner.ts                    # scan(options) -> ScanResult
│  │  ├─ suppressions.ts               # inline disable comments
│  │  ├─ baseline.ts                   # read/write/filter baseline
│  │  └─ score.ts                      # score + grade
│  ├─ ts/
│  │  ├─ project.ts                    # create ts-morph Project, add candidate files only
│  │  ├─ boundary.ts                   # classifyBoundary(sourceFile) -> client|server|edge|middleware|unknown
│  │  ├─ import-graph.ts               # who imports whom, reachable-from-client set
│  │  ├─ supabase-calls.ts             # find getSession/getUser/rpc/storage/createClient calls
│  │  ├─ taint.ts                      # tiny same-function taint: request input -> .eq() arg
│  │  └─ ast-utils.ts                  # enclosingFunction(), isModuleScope(), stringArg()
│  ├─ sql/
│  │  ├─ tokenizer.ts                  # handles '...', "...", $$...$$, $tag$...$tag$, -- , /* */
│  │  ├─ splitter.ts                   # splitStatements(sql) -> Statement[] with line offsets
│  │  ├─ schema-index.ts               # buildSchemaIndex(files) -> SchemaIndex
│  │  ├─ parse-table.ts                # CREATE TABLE, ALTER TABLE ENABLE RLS
│  │  ├─ parse-policy.ts               # CREATE POLICY (cmd, roles, using, withCheck)
│  │  ├─ parse-function.ts             # CREATE FUNCTION (args, SECURITY DEFINER, SET search_path, body)
│  │  ├─ parse-index.ts                # CREATE INDEX, PRIMARY KEY, UNIQUE
│  │  ├─ parse-grants.ts               # GRANT / REVOKE EXECUTE
│  │  ├─ parse-view.ts                 # CREATE VIEW, security_invoker
│  │  └─ sql-utils.ts                  # isWrappedInSelect(), findAuthCalls()
│  ├─ config-files/
│  │  ├─ toml.ts                       # parse supabase/config.toml
│  │  └─ env-files.ts                  # parse .env*, .gitignore check
│  ├─ rules/
│  │  ├─ index.ts                      # export const allRules: Rule[]
│  │  ├─ sg001-server-get-session.ts
│  │  ├─ sg002-unscoped-service-role.ts
│  │  ├─ sg003-client-service-key-leak.ts
│  │  ├─ sg004-exposed-security-definer-rpc.ts
│  │  ├─ sg005-uncached-rls-auth-call.ts
│  │  ├─ sg006-null-short-circuit-rls.ts
│  │  ├─ sg007-missing-rls-index.ts
│  │  ├─ sg008-unprotected-storage-write.ts
│  │  ├─ sg009-singleton-client-serverless.ts
│  │  ├─ sg010-table-without-rls.ts
│  │  ├─ sg011-rls-enabled-no-policies.ts
│  │  ├─ sg012-user-metadata-in-policy.ts
│  │  ├─ sg013-security-definer-no-search-path.ts
│  │  ├─ sg014-view-bypasses-rls.ts
│  │  ├─ sg015-policy-missing-with-check.ts
│  │  ├─ sg016-edge-verify-jwt-disabled.ts
│  │  ├─ sg017-public-env-secret.ts
│  │  └─ sg018-unguarded-llm-route.ts
│  ├─ fixes/
│  │  ├─ apply.ts                      # apply TextEdits, create files, dry-run diff
│  │  └─ sql-patch-writer.ts           # new migration file naming + content
│  ├─ reporters/
│  │  ├─ index.ts                      # getReporter(format)
│  │  ├─ pretty.ts
│  │  ├─ json.ts
│  │  ├─ sarif.ts                      # SARIF 2.1.0
│  │  ├─ github.ts                     # ::error file=,line=,col=::msg
│  │  ├─ markdown.ts                   # PR comment
│  │  ├─ html.ts                       # single self-contained file
│  │  ├─ lovable-prompt.ts
│  │  └─ badge.ts                      # shields.io endpoint JSON
│  ├─ mcp/
│  │  └─ server.ts                     # tools: scan_project, explain_rule, list_rules
│  └─ utils/
│     ├─ fs.ts
│     ├─ line-map.ts                   # offset <-> line/col
│     └─ logger.ts
├─ tests/
│  ├─ fixtures/
│  │  ├─ SG001/{bad,good}/...          # mini projects; each has expected.json in bad/
│  │  ├─ SG002/ ... SG018/
│  │  └─ _clean-app/                   # must produce 0 findings
│  ├─ sql/{tokenizer,splitter,policy,function}.test.ts
│  ├─ ts/{boundary,import-graph,supabase-calls}.test.ts
│  ├─ rules/sgXXX.test.ts              # one per rule; table-driven over fixtures
│  ├─ fixes/apply.test.ts
│  ├─ reporters/{sarif,markdown,lovable-prompt}.test.ts
│  └─ cli/e2e.test.ts                  # runs built CLI against examples/
├─ examples/
│  ├─ vulnerable-nextjs-app/           # every rule fires at least once
│  └─ vulnerable-lovable-app/          # Vite SPA + supabase/functions + migrations
├─ docs/
│  ├─ index.md
│  ├─ architecture.md
│  ├─ writing-a-rule.md
│  ├─ suppressing.md
│  ├─ ci.md
│  └─ rules/SG001.md ... SG018.md      # GENERATED by scripts/gen-docs.ts
├─ scripts/
│  ├─ gen-docs.ts                      # rule meta -> docs/rules/*.md + README table block
│  ├─ new-rule.ts                      # scaffold: pnpm new-rule SG019 name
│  └─ bench.ts                         # time scan over examples + big fixture
└─ .github/
   ├─ workflows/{ci.yml,release.yml,self-scan.yml}
   ├─ ISSUE_TEMPLATE/{bug.yml,false-positive.yml,new-rule.yml}
   └─ PULL_REQUEST_TEMPLATE.md
```

---

## 5. CORE TYPES (`src/core/types.ts`) - COPY EXACTLY

```ts
export type Severity = 'error' | 'warning' | 'info';
export type Layer = 'ts' | 'sql' | 'cross' | 'config';
export type Boundary = 'client' | 'server' | 'edge' | 'middleware' | 'unknown';

export interface TextEdit {
  file: string;        // relative path
  start: number;       // 0-based char offset, inclusive
  end: number;         // 0-based char offset, exclusive
  text: string;        // replacement
}

export interface NewFile {
  file: string;        // relative path, e.g. supabase/migrations/20260101000000_sg004_revoke_fn.sql
  content: string;
}

export interface Fix {
  description: string;
  safe: boolean;       // false => requires --unsafe
  edits: TextEdit[];
  newFiles?: NewFile[];
}

export interface Finding {
  ruleId: string;      // 'SG001'
  ruleName: string;    // 'ServerAuthGetSessionSpoof'
  severity: Severity;
  message: string;     // one sentence, says WHAT and WHY
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;    // the offending line, trimmed
  related?: { file: string; line: number; note: string }[]; // e.g. the SQL def of an RPC
  fix?: Fix;
  docsUrl: string;     // https://github.com/malikad778/supabase-edge-guard/blob/main/docs/rules/SG001.md
}

export interface RuleMeta {
  id: string;
  name: string;
  severity: Severity;
  layer: Layer;
  summary: string;               // 1 line
  incident: string;              // real-world failure this prevents (2-3 sentences)
  badExample: string;            // code block text
  goodExample: string;
  fixable: 'none' | 'safe' | 'unsafe' | 'both';
  references: string[];          // URLs (Supabase docs etc.)
  frameworks?: string[];         // omit = all
}

export interface Rule {
  meta: RuleMeta;
  check(ctx: ProjectContext): Finding[];
}

export interface ProjectContext {
  root: string;
  config: ResolvedConfig;
  framework: 'next-app' | 'next-pages' | 'tanstack-start' | 'lovable-vite' | 'generic';
  ts: TsIndex;           // from src/ts
  sql: SchemaIndex;      // from src/sql
  supabaseConfig: SupabaseConfig | null;   // parsed supabase/config.toml
  envFiles: EnvFile[];
  report(f: Omit<Finding,'docsUrl'|'ruleName'|'severity'> & { severity?: Severity }): Finding; // helper that fills defaults is created per-rule in scanner
}

export interface SchemaIndex {
  tables: Map<string, TableInfo>;          // key 'schema.name' (default schema 'public')
  policies: PolicyInfo[];
  functions: Map<string, FunctionInfo>;    // key 'schema.name' (overloads: array in info.overloads)
  views: ViewInfo[];
  indexes: IndexInfo[];
  grants: GrantInfo[];                     // GRANT/REVOKE EXECUTE statements
  files: { file: string; text: string }[];
}

export interface TableInfo {
  schema: string; name: string; file: string; line: number;
  rlsEnabled: boolean; rlsForced: boolean;
  columns: string[]; primaryKey: string[]; uniqueCols: string[][];
  foreignKeys: { column: string; refTable: string }[];
}
export interface PolicyInfo {
  name: string; schema: string; table: string; command: 'ALL'|'SELECT'|'INSERT'|'UPDATE'|'DELETE';
  roles: string[]; using?: string; withCheck?: string;
  file: string; line: number; usingOffset?: number; withCheckOffset?: number; // offsets into file text
}
export interface FunctionInfo {
  schema: string; name: string; argTypes: string[]; securityDefiner: boolean;
  searchPathSet: boolean; body: string; file: string; line: number;
}
export interface ViewInfo { schema: string; name: string; securityInvoker: boolean; file: string; line: number; }
export interface IndexInfo { schema: string; table: string; columns: string[]; unique: boolean; file: string; line: number; }
export interface GrantInfo {
  kind: 'GRANT'|'REVOKE'; privilege: string; objectType: 'FUNCTION'|'TABLE'|'OTHER';
  objectName: string; roles: string[]; file: string; line: number;
}
```

(`TsIndex`, `SupabaseConfig`, `EnvFile`, `ResolvedConfig` are defined in `src/ts/project.ts`, `src/config-files/*`, `src/core/config.ts` respectively; each must be exported and re-exported from `types.ts`.)

---

## 6. PIPELINE (`src/core/scanner.ts`)

```
scan(options)
 1. loadConfig(root)                       -> ResolvedConfig
 2. discoverFiles(root, config)            -> { tsFiles, sqlFiles, tomlFile, envFiles }
 3. detectFramework(root)                  -> framework
 4. buildSchemaIndex(sqlFiles)             -> SchemaIndex        (src/sql)
 5. buildTsIndex(tsFiles)                  -> TsIndex            (src/ts)  [pre-filter files, see below]
 6. build ProjectContext
 7. for rule in enabledRules: findings.push(...rule.check(ctx))   (wrap each rule in try/catch -> SG000 internal error info)
 8. applySuppressions(findings)            (inline comments)
 9. applyBaseline(findings)                (if --baseline)
10. sort by file, line; compute score
11. return { findings, score, grade, stats }
```

**TS performance rule:** before adding a file to ts-morph, read text and include it only if it contains any of: `supabase`, `createServerFn`, `createClient`, `createServerClient`, `use server`, `use client`, `Deno.serve`, `NEXT_PUBLIC_`, `SERVICE_ROLE`, `.rpc(`, `.storage`. Target: 1,000 files < 3 s.

---

## 7. SQL LAYER SPEC

### 7.1 Tokenizer / splitter (`tokenizer.ts`, `splitter.ts`)
`splitStatements(text): { text: string; startOffset: number; startLine: number }[]`

Must correctly skip semicolons inside:
- single-quoted strings (`''` escape)
- double-quoted identifiers
- dollar quotes `$$ ... $$` and `$tag$ ... $tag$`
- `-- line comments` and `/* block comments (nestable) */`

Comments are replaced by spaces of equal length in a **masked copy** (so offsets stay valid) - all regex runs on masked text, snippets come from original.

### 7.2 Parsers (each takes a statement, returns info or null)
- `parse-table.ts`: `CREATE TABLE [IF NOT EXISTS] [schema.]name (...)` → columns, inline `PRIMARY KEY`, `UNIQUE`, `REFERENCES`. `ALTER TABLE [ONLY] [schema.]name ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` mutate the table record. Default schema = `public`. Unknown table in ALTER → ignore.
- `parse-policy.ts`: `CREATE POLICY "name" ON [schema.]table [AS PERMISSIVE|RESTRICTIVE] [FOR cmd] [TO roles] [USING (expr)] [WITH CHECK (expr)]`. Extract balanced-paren expressions. Record **absolute offsets** of expressions.
- `parse-function.ts`: `CREATE [OR REPLACE] FUNCTION [schema.]name(args) ... [SECURITY DEFINER|INVOKER] ... [SET search_path = ...] AS $$ body $$`. Arg types only (drop names/defaults).
- `parse-index.ts`: `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON [schema.]table [USING m] (cols)`. Leading column = first element. Strip `ASC/DESC/NULLS`.
- `parse-grants.ts`: `GRANT|REVOKE EXECUTE ON FUNCTION name(args) FROM|TO roles`; also `ALTER FUNCTION ... SECURITY INVOKER` ignored.
- `parse-view.ts`: `CREATE [OR REPLACE] VIEW name [WITH (security_invoker = true|on)] AS`.

### 7.3 Ordering semantics
Process migration files **sorted by filename** (timestamp prefix). Later statements override earlier ones (e.g. a later `ALTER TABLE ... ENABLE RLS`, a later `CREATE OR REPLACE FUNCTION`, a later `DROP POLICY`). Handle `DROP POLICY`, `DROP FUNCTION`, `DROP TABLE`, `DROP INDEX`, `DROP VIEW` by removing the entry. This avoids false positives on already-fixed old migrations. Also read `supabase/seed.sql`? **No** (skip).

### 7.4 Helper `sql-utils.ts`
- `findAuthCalls(expr): {fn:'uid'|'jwt'|'role'|'email', offset:number, len:number}[]` - regex `\bauth\s*\.\s*(uid|jwt|role|email)\s*\(\s*\)`; also `current_setting\(`.
- `isWrappedInSelect(expr, offset)`: walk backwards from `offset` to find the nearest **unmatched** `(`; return true if text after it (trim) starts with `select` (case-insens.). Used by SG005.

---

## 8. TYPESCRIPT LAYER SPEC

### 8.1 Boundary classification (`boundary.ts`)
Order of checks (first match wins):
1. File path under `supabase/functions/` → `edge`.
2. File basename `middleware.ts|js` at root or `src/` → `middleware`.
3. First statement is directive `'use client'` → `client`.
4. First statement is `'use server'` → `server`.
5. Path matches `app/**/route.(ts|js)` or `pages/api/**` → `server`.
6. Path matches `app/**/(page|layout|template|loading|error).(tsx|jsx)` without `'use client'` → `server`.
7. File contains call `createServerFn(` → `server` (TanStack Start).
8. File under `src/` in `lovable-vite` framework, not edge → `client`.
9. Otherwise `unknown`.

**Function-level `'use server'`**: an async function whose body starts with `'use server'` is a server context even inside a client file? (Not allowed in client files; but in server component files it marks Server Actions.) `enclosingBoundary(node)` returns `server` for nodes inside such function.

### 8.2 Import graph (`import-graph.ts`)
- Resolve relative imports and `@/` alias (read `tsconfig.json` `paths`; fallback `@/ → src/` or `./`).
- Resolve extension-less + `/index`.
- `clientReachable: Set<string>` = BFS from all `client` files following import edges. Used by SG003.
- Cap depth 20; ignore `node_modules`.

### 8.3 Supabase call finder (`supabase-calls.ts`)
Return typed lists:
```ts
interface SupabaseCall { kind:'getSession'|'getUser'|'getClaims'|'rpc'|'storageUpload'|'createClient'|'fromMutation'|'setSession'; node: Node; file:string; line:number; fnName?:string; receiverText:string; }
```
Detection by **shape, not by variable name**:
- `<expr>.auth.getSession()` - property access chain whose last two segments are `auth`, `getSession`.
- `<expr>.rpc('name', ...)` - first arg string literal (or no-substitution template).
- `<expr>.storage.from('bucket').upload|update|remove|move|copy(...)`.
- `createClient(` / `createServerClient(` / `createBrowserClient(` imported from `@supabase/supabase-js` or `@supabase/ssr` (check import specifier; also accept Deno `npm:@supabase/supabase-js` / `jsr:` / `https://esm.sh/@supabase/supabase-js`).
- Track admin clients: variable initialised from a `createClient(...)` call whose args text contains `SERVICE_ROLE` → add to `adminClientNames` for that scope.

### 8.4 Tiny taint (`taint.ts`)
Same-function only. "Tainted" identifiers = assigned from: `req.body*`, `request.json()`, `await req.json()`, `formData.get(...)`, `params.*`, `searchParams.get(...)`, `req.query.*`, `data` param of `createServerFn().handler(({data}) => ...)`, destructured from those. Propagates through simple `const a = tainted.x` and destructuring. No inter-procedural. Exposes `isTainted(expr: Node): boolean`.

---

## 9. RULES - FULL SPECS

Severity default shown. Users can override in config.

### SG001 `ServerAuthGetSessionSpoof` - error - ts - fix: safe/unsafe
- **Detect:** every `getSession` call whose enclosing boundary is `server | edge | middleware`.
- **Do NOT flag when:**
  - same function also calls `.auth.getUser(` or `.auth.getClaims(` (common middleware pattern), AND
  - `session.user` is not read (only `access_token` or nothing).
  - file boundary is `client` or `unknown`.
- **Message:** `getSession() on the server reads an unverified cookie. Use getUser() (or getClaims()) to validate the JWT.`
- **Fix:** Rewrite `getSession()` → `getUser()` ONLY when the result is destructured as `{ data: { session } }` and usages of `session` are limited to `session.user` / `session?.user` / null-checks - then also rewrite destructuring `session` → `user` and `session.user` → `user`. Mark `safe: true` only if all usages were rewritten mechanically; else report without fix.
- **Fixtures:** server action, route handler, middleware, TanStack `createServerFn`, good: client component, good: getSession+getUser together.

### SG002 `UnscopedServiceRoleMutation` - error - ts
- **Detect:** in `server | edge` boundary, an admin client (see 8.3) used in a chain `.from(x).(select|insert|update|delete|upsert)(...)` where **any** of:
  - a `.eq()/.match()/.filter()/.in()` argument or `.insert/.update/.upsert` payload is **tainted** (8.4), OR
  - the enclosing function contains **no** `auth.getUser(`/`getClaims(` call before the chain (source order).
- **Do NOT flag:** top-level scripts under `scripts/`, `seed*`, `*.test.*`, cron routes that check a secret header (`CRON_SECRET`/`authorization === \`Bearer ${process.env`).
- **Message:** `service_role client bypasses all RLS; '<arg>' comes from user input and is not checked against the authenticated user.`
- **Fix:** none.

### SG003 `ClientBundleServiceKeyLeak` - error - ts
- **Detect:** any of the following in a file in `clientReachable`:
  - identifier/string/`process.env.X`/`import.meta.env.X` containing `SERVICE_ROLE` (case-insens.).
  - import of a module that itself contains `SERVICE_ROLE` and is imported by a `client` file (report at the import line, `related` → the module).
- **Message:** `service_role key is reachable from client bundle (via <path>).`
- **Fix:** none.

### SG004 `ExposedSecurityDefinerRpc` - error - cross - fix: safe (new migration)
- **Detect:** for each `.rpc('fn')` in **any** boundary (client rpc is the worst case), find `FunctionInfo` by name in `public` (or named schema). Flag when `securityDefiner` AND NOT guarded, where guarded means:
  - function body contains `auth.uid()` (and compares/uses it, i.e. appears in `IF`/`WHERE`/`RAISE`), OR
  - a later `REVOKE EXECUTE ON FUNCTION fn(args) FROM PUBLIC` **and** `FROM anon` (both; Supabase default privileges re-grant to `anon`), OR
  - `GRANT EXECUTE ... TO service_role` only.
- **related:** pointer to SQL definition file/line.
- **Fix (safe):** new file `supabase/migrations/<UTC yyyymmddhhmmss>_sg004_revoke_<fn>.sql`:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.fn(arg_types) FROM PUBLIC, anon;
  -- Add an auth.uid() ownership check inside the function body before granting to authenticated.
  ```
- Also report (warning) SECURITY DEFINER functions in `public` that are **never** called by `.rpc` but unguarded? **No** (v2).

### SG005 `UncachedRlsAuthUidCall` - warning - sql - fix: safe
- **Detect:** in every `PolicyInfo.using` / `.withCheck`, each `findAuthCalls()` hit where `!isWrappedInSelect(expr, offset)`.
- **Message:** `auth.uid() is re-evaluated per row. Wrap in (select auth.uid()) so Postgres caches it (initPlan).`
- **Fix:** replace the call text with `(select auth.uid())` (same for `auth.jwt()`, `auth.role()`, `auth.email()`) using absolute offsets from `usingOffset/withCheckOffset`. Apply edits right-to-left within a file.
- **Edge:** if already `( select auth.uid() )` with whitespace/newlines/case differences → treated as wrapped.

### SG006 `NullShortCircuitRlsLeak` - error - sql
- **Detect (regex on masked expression):**
  - `auth\.uid\(\)\s+IS\s+NULL\s+OR`
  - `OR\s+auth\.uid\(\)\s+IS\s+NULL`
  - `\(\s*select\s+auth\.uid\(\)\s*\)\s+IS\s+NULL\s+OR` (and reverse)
  - `USING\s*\(\s*true\s*\)` on non-SELECT public tables → flag as **SG006 warning variant** only when role list includes `anon` or is empty; for `SELECT` with `true` → `info`.
- **Fix:** none.

### SG007 `MissingRlsIndexOnPolicyColumn` - warning - sql - fix: safe
- **Detect:** for each policy, collect column identifiers on the policy's table that appear in expressions of the form `col = (select auth.uid())`, `col IN (select ...)`, `col = auth.uid()`, `col = <fn>()`. Check index exists whose **leading column** = col, OR col is primary key leading column, OR unique constraint leading column.
- **Message:** `Policy "x" filters on <table>.<col> but no index exists; every query will sequentially scan.`
- **Fix:** new migration: `CREATE INDEX IF NOT EXISTS <table>_<col>_idx ON <schema>.<table> (<col>);`

### SG008 `UnprotectedStorageBucketWrite` - error - cross
- **Detect:** `.storage.from('b').upload|update|remove(...)` in `client` boundary. Look for policies on `storage.objects` (table `objects`, schema `storage`) with command `INSERT|UPDATE|DELETE|ALL` whose expression mentions `bucket_id = 'b'`. Flag when:
  - no such policy exists, OR
  - the policy has no ownership constraint: neither `storage.foldername(name)` nor `owner` / `owner_id` / `auth.uid()` appears.
- **Also:** `INSERT INTO storage.buckets ... public = true` + write policy for `anon` → error.
- **Fix:** none (print suggested policy in `message` hint).

### SG009 `SingletonClientInServerless` - error - ts
- **Detect:** in `edge` or `server` boundary, a `createClient|createServerClient` call at **module scope** (`isModuleScope`) assigned to a variable `v`, AND inside any function in the same file: `v.auth.setSession(`, `v.auth.setAuth(`, `v.functions.setAuth(`, `v.realtime.setAuth(`, or `v.rest.headers[...] =` / `Object.assign(v.rest.headers`.
- **Do NOT flag:** module-scope client created with anon key and used read-only; module-scope service role (that is SG002's domain).
- **Fix:** none.

### SG010 `TableWithoutRls` - error - sql - fix: safe
- **Detect:** `TableInfo` with `schema in ('public', ...exposedSchemas from supabase/config.toml [api].schemas)` where `rlsEnabled === false` after processing **all** migrations. Skip tables listed in config `ignoreTables`. Skip names starting with `_` or `pg_`.
- **Fix (safe):** new migration `ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;`
- **Priority:** this is the most common real-world Lovable leak → put it first in pretty output.

### SG011 `RlsEnabledNoPolicies` - info - sql
- **Detect:** table with `rlsEnabled` and zero policies (after DROP handling). Message: `RLS enabled but no policies: table is unreadable via anon/authenticated (OK only if server-only).`

### SG012 `UserMetadataInPolicy` - error - sql
- **Detect:** in any policy expr: `user_metadata`, `raw_user_meta_data`, `auth.jwt()\s*->\s*'user_metadata'`, `auth.jwt()\s*->>\s*'user_metadata'`. Message: `user_metadata is editable by the user; never use it for authorization. Use app_metadata or a roles table.`

### SG013 `SecurityDefinerNoSearchPath` - warning - sql - fix: unsafe
- **Detect:** `FunctionInfo.securityDefiner && !searchPathSet`.
- **Fix (unsafe):** new migration `ALTER FUNCTION public.fn(args) SET search_path = '';` and note body must schema-qualify objects.

### SG014 `ViewBypassesRls` - error - sql - fix: unsafe
- **Detect:** `ViewInfo` in exposed schema with `!securityInvoker` whose definition selects from a table that has `rlsEnabled` (Postgres 15+; views run as owner and bypass RLS). Fix: `ALTER VIEW x SET (security_invoker = true);`

### SG015 `PolicyMissingWithCheck` - warning - sql
- **Detect:** policy `FOR UPDATE` or `FOR ALL` with `USING` but no `WITH CHECK`, on a table having a `user_id`/`owner_id`/`*_id` column used in USING. Message: user can update a row and reassign ownership.

### SG016 `EdgeVerifyJwtDisabled` - warning - config
- **Detect:** `supabase/config.toml` `[functions.<name>] verify_jwt = false` AND function code (`supabase/functions/<name>/index.ts`) does not read `Authorization` header, nor `getUser(`, nor a webhook signature verify (`constructEvent`, `verify(`, `hmac`, `timingSafeEqual`).

### SG017 `PublicEnvSecret` - error - config
- **Detect:** (a) `.env*` or code references with `NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_` prefix + name matching `/(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|STRIPE_SK|OPENAI|ANTHROPIC)/i`; (b) `.env` / `.env.local` exists and is not matched by `.gitignore` (warning).

### SG018 `UnguardedLlmRoute` - warning - ts
- **Detect:** in `server`/`edge` boundary file: call to `streamText|generateText|streamObject|openai.chat.completions.create|anthropic.messages.create|fetch('https://api.openai.com…')` AND none of: exported `maxDuration`, `export const runtime = 'edge'`, `AbortSignal.timeout(`, `@upstash/ratelimit` import, `Ratelimit`, `rateLimit(` call, `waitUntil(`.
- **Message:** `LLM call without maxDuration / rate limit: risks Vercel 504 / Cloudflare 524 and cost abuse.`

---

## 10. FIX ENGINE (`src/fixes/apply.ts`)

```
applyFixes(findings, { unsafe: boolean, dryRun: boolean, root }) -> { applied: Fix[], skipped: {finding, reason}[], diffs: string[] }
```
Algorithm:
1. Collect fixes where `fix.safe || unsafe`.
2. Group `TextEdit`s by file. Sort by `start` **descending**. If two edits overlap → skip the later finding, record reason `overlap`.
3. Read file → apply → (dry-run: produce unified diff with `diff` pkg; else write).
4. `newFiles`: if path exists → skip; else write. Timestamp = `new Date()` UTC `YYYYMMDDHHmmss`; if collision, +1 second until free. Multiple SQL fixes in one run → **merge into ONE migration file** `..._edge_guard_fixes.sql` with commented sections per rule (nicer for users).
5. After applying, **re-scan** and print `fixed N / remaining M`.
6. Never touch files outside root. Never apply when git working tree is dirty unless `--allow-dirty` (check via `git status --porcelain`, ignore failures if not a git repo).

---

## 11. CLI SPEC

```
supabase-edge-guard [scan] [path]        # default command; path default '.'
  --format <pretty|json|sarif|github|markdown|html|lovable-prompt|badge>   (default pretty)
  --output <file>            write report to file instead of stdout
  --fail-on <error|warning|info|never>   (default error)
  --rules <SG001,SG005>      only these
  --ignore-rules <SG011>
  --fix                      apply safe fixes
  --unsafe                   with --fix also apply unsafe fixes
  --dry-run                  show diffs, change nothing
  --allow-dirty
  --baseline <file>          hide findings present in baseline (default .edge-guard-baseline.json if exists)
  --changed-only             only report findings in files changed vs git HEAD / base ref
  --no-color
  --quiet                    only print findings
supabase-edge-guard init                 # writes config, GH workflow, optional husky/pre-commit
supabase-edge-guard explain <SG001>      # prints meta: incident, bad, good, refs
supabase-edge-guard list-rules [--json]
supabase-edge-guard baseline [path]      # writes .edge-guard-baseline.json
supabase-edge-guard mcp                  # stdio MCP server
```
Exit codes: `0` no findings at/above `--fail-on`; `1` findings at/above; `2` internal/usage error.

Pretty output sketch:
```
 supabase-edge-guard v0.1.0  - Next.js (app router) · 142 TS files · 11 migrations

 ✖ error  SG010  Table "public.orders" has no Row Level Security
          supabase/migrations/001_init.sql:14
          14 │ create table public.orders (
          fix available → run with --fix
 ...
 Score: 42/100  Grade: D     6 errors · 4 warnings · 1 info
 Next: supabase-edge-guard --fix    |    --format lovable-prompt
```

---

## 12. CONFIG & SUPPRESSION

### `supabase-edge-guard.config.json` (also `.supabase-edge-guardrc.json`, or `"edgeGuard"` key in package.json)
```json
{
  "$schema": "https://unpkg.com/supabase-edge-guard/schema.json",
  "include": ["app/**", "src/**", "pages/**", "supabase/**"],
  "exclude": ["**/*.test.ts", "**/node_modules/**", "**/.next/**"],
  "migrationsDir": "supabase/migrations",
  "functionsDir": "supabase/functions",
  "rules": { "SG011": "off", "SG005": "error", "SG018": "warning" },
  "ignoreTables": ["public.schema_migrations"],
  "exposedSchemas": ["public"],
  "failOn": "error"
}
```
Zod schema in `config.ts`; unknown keys → warning, not crash. Generate `schema.json` via `zod-to-json-schema` **only in build script** (dev dep allowed: `zod-to-json-schema`).

### Inline suppressions (`suppressions.ts`)
TS: `// edge-guard-disable-next-line SG001 -- reason text`
SQL: `-- edge-guard-disable-next-line SG005 -- reason text`
File-level: `// edge-guard-disable-file SG002 -- reason`
- A **reason after `--` is required**; without it the suppression is ignored and an `info` finding `SG000 SuppressionWithoutReason` is emitted.
- Multiple IDs comma-separated.

### Baseline
`.edge-guard-baseline.json`: array of `{ruleId, file, fingerprint}` where `fingerprint = sha1(ruleId + file + normalizedSnippet)` (line-independent so edits above don't invalidate).

---

## 13. REPORTERS

- **sarif.ts** - SARIF 2.1.0: `tool.driver.rules` from meta (id, name, shortDescription, helpUri, defaultConfiguration.level: error→`error`, warning→`warning`, info→`note`), `results[].locations[0].physicalLocation.artifactLocation.uri` (relative) + `region{startLine,startColumn}`, `partialFingerprints` = baseline fingerprint. Must validate against official schema in test (vendored schema JSON in `tests/reporters/`).
- **github.ts** - `::error file=...,line=...,col=...,title=SG001::message` (warning→`::warning`, info→`::notice`).
- **markdown.ts** - PR comment: header with grade badge, table by severity, collapsible `<details>` per rule, hidden marker `<!-- supabase-edge-guard -->` so Action updates the same comment.
- **html.ts** - one self-contained file, no external requests, dark/light, filter by severity, copy-fix-prompt button.
- **lovable-prompt.ts** - output template:
  ```
  You are fixing security issues in my Supabase app. Apply ALL changes below. Do not change anything else.
  1. [SG010] In supabase/migrations/001_init.sql the table public.orders has no RLS. Add a new migration that runs: ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY; and add policies so users can only access rows where user_id = (select auth.uid()).
  2. [SG001] In app/actions/profile.ts line 12, replace supabase.auth.getSession() with supabase.auth.getUser() and use data.user.
  ...
  After applying, list every file you changed.
  ```
  One numbered item per finding; always include file + line + the exact replacement when a fix exists.
- **badge.ts** - `{ "schemaVersion":1, "label":"edge-guard", "message":"A (96)", "color":"brightgreen" }`.
- **Score:** `100 - 10*errors - 3*warnings - 1*infos`, floor 0. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 50, F < 50.

---

## 14. VIRAL / ADOPTION FEATURES (SPEC)

1. **`--format lovable-prompt`** (above). README hero shows paste-into-Lovable flow with GIF.
2. **README badge**: `![edge-guard](https://img.shields.io/endpoint?url=...)` - document the 3-line Action step that publishes `badge.json` to a gist / `gh-pages`.
3. **GitHub Action** (`action.yml`, composite):
   - inputs: `path`, `fail-on`, `sarif` (bool), `comment` (bool), `version`.
   - steps: setup-node → `npx -y supabase-edge-guard@${version} --format sarif --output edge-guard.sarif --fail-on never` → `github/codeql-action/upload-sarif` → `--format markdown` → post/update PR comment via `gh api` using hidden marker → final step runs scan with real `--fail-on` to set exit code.
4. **`init`** writes: config file, `.github/workflows/edge-guard.yml`, and (if `.husky` exists) a pre-commit entry `npx supabase-edge-guard --changed-only --fail-on error`.
5. **MCP server** tools: `scan_project({path})`, `explain_rule({id})`, `list_rules()`. Returns JSON findings + lovable-prompt text. Add copy-paste config snippets for Cursor and Claude Code to README.
6. **`examples/vulnerable-*`**: every rule fires. README shows before/after. CI e2e test asserts exact finding set.
7. **State of Supabase Security report** (M9): run the tool over the top public Next.js+Supabase / Lovable repos; publish counts per rule in `docs/state-of-supabase-security.md` + blog post. **Only publish real numbers produced by `scripts/bench-public.ts`; never invent statistics.** Don't name individual repos negatively - aggregate only, and disclose privately first if anything is critical.
8. **Rule pages with real incidents**, each linked from findings (`docsUrl`) - SEO long-tail ("supabase getSession vs getUser").
9. **Playground (v0.3, optional)**: static site (`docs/playground`) that bundles the scanner to the browser (TS part only via `ts-morph` is heavy → use SQL-only + regex TS in playground). Nice-to-have, skip until after launch.
10. **"Contribute a rule" funnel**: `pnpm new-rule SG019 my-rule` scaffolds rule + fixtures + test + docs stub; label 10 issues `good first issue` with rule ideas.

---

## 15. CONFIG FILES TO CREATE

### `package.json`
```json
{
  "name": "supabase-edge-guard",
  "version": "0.1.0",
  "description": "Cross-boundary static analyzer for Next.js, TanStack Start, Lovable and Supabase apps. Catches getSession() spoofing, service_role bypasses, exposed SECURITY DEFINER RPCs and RLS mistakes before deploy.",
  "type": "module",
  "bin": { "supabase-edge-guard": "bin/supabase-edge-guard.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "bin", "schema.json", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "gen-docs": "tsx scripts/gen-docs.ts",
    "new-rule": "tsx scripts/new-rule.ts",
    "bench": "tsx scripts/bench.ts",
    "prepublishOnly": "pnpm build && pnpm test && pnpm gen-docs"
  },
  "keywords": ["supabase","nextjs","lovable","rls","security","static-analysis","sarif","tanstack-start","row-level-security","cli"],
  "repository": { "type": "git", "url": "git+https://github.com/malikad778/supabase-edge-guard.git" },
  "license": "MIT",
  "publishConfig": { "access": "public", "provenance": true }
}
```
(Add `tsx` as dev dep for scripts.)

### `tsconfig.json`
`target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `noUncheckedIndexedAccess true`, `exactOptionalPropertyTypes false`, `skipLibCheck true`, `outDir dist`, `include ["src","scripts","tests"]`. **Exclude `tests/fixtures`** (they contain intentionally bad code).

### `tsup.config.ts`
entries: `src/index.ts`, `src/cli/main.ts`; format `esm`; `dts: true`; `clean: true`; `target: 'node18'`; `external: ['@modelcontextprotocol/sdk']`.

### `vitest.config.ts`
`include: ['tests/**/*.test.ts']`, `exclude: ['tests/fixtures/**']`.

### `.github/workflows/ci.yml`
matrix `node: [18, 20, 22]` × `os: [ubuntu-latest, windows-latest]` (Windows matters: path separators) → `pnpm i --frozen-lockfile` → `typecheck` → `lint` → `build` → `test`.

### `.github/workflows/self-scan.yml`
Run the tool against `examples/vulnerable-nextjs-app` and assert expected SARIF finding count (guards regressions), upload SARIF.

### `.github/workflows/release.yml`
On tag `v*`: build, test, `npm publish --provenance`, create GitHub release from `CHANGELOG.md`.

---

## 16. TESTING STRATEGY

### Fixture layout (per rule)
```
tests/fixtures/SG001/
  bad/
    app/actions/profile.ts
    expected.json          # [{"ruleId":"SG001","file":"app/actions/profile.ts","line":5}]
  good/
    app/components/Profile.tsx
    (no expected.json => must produce zero findings for THIS rule)
```
### Table-driven test (`tests/rules/_harness.ts`)
```ts
export async function runFixture(ruleId: string, kind: 'bad'|'good') // scans fixture dir with only that rule enabled
```
- `bad`: findings (ruleId, file, line) must **exactly equal** `expected.json`.
- `good`: findings for that rule must be `[]`.
- `_clean-app`: ALL rules enabled → `[]`.

### Must-have test cases per rule (minimum)
- 2 bad variants (different syntax), 2 good variants (near-misses that must NOT fire).
- SG005: already wrapped with weird whitespace/case; policy with `auth.uid()` in string literal/comment (must not fire).
- SG004: overloaded function; later migration revokes; function guarded by `auth.uid()` in body.
- SG010: table created in migration 1, RLS enabled in migration 3 → NOT flagged; table dropped later → NOT flagged.
- Windows path test: backslashes normalized.
- Splitter: `$$` body containing `;`, `$fn$`, nested comments, `E'..\'..'` escapes.

### Other tests
- `fixes/apply.test.ts`: overlapping edits, right-to-left application, newFile collision, dry-run produces diff and writes nothing, merged SQL migration.
- Reporter snapshot tests + SARIF schema validation.
- `cli/e2e.test.ts`: build then run `node bin/... examples/vulnerable-nextjs-app --format json` → assert exit code 1 and finding set; run on `_clean-app` → exit 0.
- Performance test: generate 1,000 synthetic TS files + 200 migrations; assert < 5 s on CI.

---

## 17. MILESTONES (BUILD ORDER)

Each milestone: tasks → **Done when**.

### M0 - Scaffold (½ day)
Create all config files in section 15, empty `src/` tree with stubs, `bin/` shim, CI.
**Done when:** `pnpm i && pnpm build && pnpm test` pass (one trivial test); `node bin/supabase-edge-guard.js --help` prints help.

### M1 - Core types, config, discovery, reporters (pretty + json) (1 day)
`types.ts`, `config.ts`, `file-discovery.ts`, `framework-detect.ts`, `line-map.ts`, `scanner.ts` with zero rules, `pretty.ts`, `json.ts`, CLI `scan`, `list-rules`.
**Done when:** CLI runs on `examples/` and prints "0 findings"; config invalid → helpful error with exit 2.

### M2 - SQL layer (2 days)
`tokenizer`, `splitter`, all `parse-*`, `schema-index` incl. ordering + DROP semantics, `sql-utils`.
**Done when:** `tests/sql/*` pass incl. all edge cases in section 16; `buildSchemaIndex` on a 20-migration sample returns the expected tables/policies/functions.

### M3 - SQL rules: SG005, SG006, SG010, SG011, SG012 (1 day)
**Done when:** each has bad/good fixtures + passing tests + docs meta.

### M4 - Fix engine + SG005/SG010 fixes (1 day)
`fixes/apply.ts`, `sql-patch-writer.ts`, `--fix`, `--dry-run`, `--unsafe`, `--allow-dirty`.
**Done when:** `--fix` on the vulnerable example removes all SG005 + SG010 findings on re-scan.

### M5 - TS layer (2 days)
`project.ts`, `boundary.ts`, `import-graph.ts`, `supabase-calls.ts`, `ast-utils.ts`, `taint.ts`.
**Done when:** unit tests classify every boundary case in 8.1 and detect every call kind in 8.3.

### M6 - TS + cross rules: SG001, SG002, SG003, SG004, SG009 (2 days)
**Done when:** fixtures pass; SG001 fix rewrites destructuring correctly in 3 variants; SG004 emits merged migration.

### M7 - Remaining rules: SG007, SG008, SG013–SG018 (2 days)
`config-files/toml.ts`, `env-files.ts`.
**Done when:** `_clean-app` yields 0 findings with all 18 rules; vulnerable examples trigger all 18.

### M8 - Reporters + suppression + baseline + score (1 day)
`sarif`, `github`, `markdown`, `html`, `lovable-prompt`, `badge`, `suppressions`, `baseline`, `score`, `--changed-only`.
**Done when:** SARIF validates; suppression without reason is rejected; baseline hides known findings and shows new ones.

### M9 - Growth features (2 days)
`init`, `explain`, `action.yml`, `mcp` command, `gen-docs.ts` (rule docs + README table), `new-rule.ts`, `bench-public.ts`, run on 20 public repos, tune false positives until < 10 %.
**Done when:** `npx` from a clean temp dir (via `pnpm pack` tarball) works on Windows/Linux; docs generated; Action tested on a sandbox repo.

### M10 - Launch (see 18)

---

## 18. LAUNCH PLAN

**Before launch checklist**
- [ ] README: hero GIF (record with `vhs`), 3-line install/run, before/after screenshot, rule table (generated), "paste into Lovable" section, CI snippet, badge snippet, MCP snippet, comparison table vs `pgrls` / ESLint / generic MCP scanners (be factual).
- [ ] 18 rule pages live; `explain` works offline.
- [ ] npm published with provenance; `npx supabase-edge-guard` verified on a clean machine.
- [ ] Demo repo `malikad778/vulnerable-supabase-demo` (pinned) with Action + red badge; a branch with fixes + green badge.
- [ ] 10 `good first issue`s (new rule ideas) + `CONTRIBUTING.md` 5-step guide.
- [ ] Topics on GitHub: `supabase nextjs lovable rls security static-analysis sarif tanstack-start vibe-coding`.
- [ ] Social preview image (1280×640) with the terminal output.

**Launch sequence**
1. Day 0: Show HN ("Show HN: A static analyzer that cross-checks your Next.js code against your Supabase migrations"), r/supabase, r/nextjs, r/lovable (follow each sub's self-promo rules), dev.to / Hashnode article: *"getSession() vs getUser(): the Supabase bug in half of vibe-coded apps"*.
2. Day 1–3: X/LinkedIn thread with GIF; post in Supabase Discord + Lovable Discord showcase channels; submit to awesome-supabase, awesome-nextjs, awesome-static-analysis.
3. Week 2: publish "State of Supabase Security" with real aggregate numbers from the bench run.
4. Ongoing: respond to every issue < 24 h; ship a rule every week (changelog = marketing); Upwork profile + proposals link the repo (Row 7 of proposal matrix).

---

## 19. DEFINITION OF DONE (v0.1.0 RELEASE GATE)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green on Node 18/20/22, Linux + Windows.
- [ ] 12 rules (SG001–SG006, SG010–SG013, SG017 minimum) with fixtures, docs, tests; all 18 by v0.2.
- [ ] `_clean-app` → 0 findings; vulnerable examples → exact expected set.
- [ ] `--fix` / `--dry-run` / `--unsafe` verified; re-scan after fix shows reduction.
- [ ] SARIF validates; GitHub Action works on a sandbox repo.
- [ ] Scan of 1,000-file synthetic project < 3 s (local) / < 5 s (CI).
- [ ] Zero network calls (verify by running tests with network disabled).
- [ ] README + docs complete; CHANGELOG entry; tag `v0.1.0`; npm publish with provenance.

---

## 20. RULE FILE TEMPLATE (`src/rules/sgXXX-name.ts`)

```ts
import type { Rule, Finding, ProjectContext } from '../core/types.js';

export const sgXXX: Rule = {
  meta: {
    id: 'SGXXX',
    name: 'RuleName',
    severity: 'warning',
    layer: 'sql',
    summary: 'One line.',
    incident: 'What broke in production and why.',
    badExample: `-- bad code`,
    goodExample: `-- good code`,
    fixable: 'none',
    references: ['https://supabase.com/docs/guides/database/postgres/row-level-security'],
  },
  check(ctx: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    // 1. iterate ctx.sql.policies / ctx.ts.* (never re-read files from disk here)
    // 2. decide
    // 3. findings.push(ctx.report({ ruleId: 'SGXXX', message: '...', file, line, column }));
    return findings;
  },
};
```
Register in `src/rules/index.ts` (`allRules` array, sorted by id). Run `pnpm gen-docs`. Done.

---

## 21. FUTURE (v1+, DO NOT BUILD NOW)

- `--db-url` live mode: introspect real RLS policies / grants from `pg_catalog` and diff against migrations (drift detection).
- `libpg-query` real SQL AST.
- Svelte/Remix/Nuxt boundary support.
- VS Code extension (diagnostics + quick fixes) reusing the core.
- Auth-helper-library checks (`@supabase/auth-helpers-*` deprecations).
- Realtime channel authorization rules (`realtime.messages` policies).
- Stripe/webhook signature verification rule family.
- Companion `woocommerce-query-guard` (Package #12) sharing the reporter/fix/baseline core as `@guard/core`.
