# Writing a Custom Rule

This guide walks through creating and testing a new security rule for `supabase-edge-guard`.

---

## 1. Scaffold the Rule

Run the scaffolding script:

```bash
pnpm new-rule SG019 MyRuleName ts
```
*(Use `sql`, `ts`, `cross`, or `config` as the layer argument).*

This generates:
- `src/rules/sg019-my-rule-name.ts` (rule implementation template)
- `tests/rules/sg019.test.ts` (test suite stub)
- Automatically registers the rule in `src/rules/index.ts`

---

## 2. Define Rule Metadata (`meta`)

Every rule must define complete metadata in its `meta` object:

```ts
export const sg019: Rule = {
  meta: {
    id: 'SG019',
    name: 'MyRuleName',
    severity: 'error',        // 'error' | 'warning' | 'info'
    layer: 'cross',           // 'ts' | 'sql' | 'cross' | 'config'
    summary: 'Brief 1-line description of the security issue.',
    incident: '2-3 sentences describing the real-world attack or failure this prevents.',
    badExample: `// vulnerable code example`,
    goodExample: `// safe remediation example`,
    fixable: 'safe',          // 'none' | 'safe' | 'unsafe' | 'both'
    references: [
      'https://supabase.com/docs/guides/database/postgres/row-level-security',
    ],
  },
  check(ctx: ProjectContext): Finding[] {
    // ...
  },
};
```

---

## 3. Implement the `check(ctx)` Function

Rules are pure functions that take `ProjectContext` and return an array of `Finding` objects:

```ts
check(ctx: ProjectContext): Finding[] {
  const findings: Finding[] = [];

  // Inspect SQL schema index
  for (const table of ctx.sql.tables.values()) {
    // ...
  }

  // Inspect TypeScript AST & call sites
  for (const call of ctx.ts.supabaseCalls) {
    // ...
  }

  findings.push(
    ctx.report({
      ruleId: 'SG019',
      message: 'Description of what is wrong and why it is dangerous.',
      file: 'supabase/migrations/001_init.sql',
      line: 12,
      column: 1,
      snippet: '...',
      // Optional fix
      fix: {
        description: 'Enable RLS on table',
        safe: true,
        edits: [...],
      },
    }),
  );

  return findings;
}
```

### Important Principles
1. **Never read files directly from disk inside `check()`.** All source text, tokens, and ASTs are preloaded into `ProjectContext`.
2. **False negatives over false positives.** If unsure whether a pattern is dangerous, do not report it.
3. **Safe vs Unsafe fixes:** Only mark `fix.safe: true` if applying the change cannot inadvertently break application semantics or data integrity.
4. **POSIX relative paths:** `file` should always use forward slashes (`/`) relative to project root.

---

## 4. Test the Rule

Add comprehensive unit tests in `tests/rules/sg019.test.ts`:
- Vulnerable variants that trigger the rule.
- Safe near-miss variants that must not trigger the rule.
- If fixable, verify the text edits apply correctly and resolve the finding upon re-scan.

If the rule should be part of the golden demo apps, update `examples/vulnerable-nextjs-app` or `examples/vulnerable-lovable-app` and refresh the expected golden findings.

---

## 5. Update Documentation & Schema

Once tests pass:

```bash
pnpm gen-docs
```

This updates:
- `docs/rules/SG019.md` (generated from `meta`)
- The rule table in `README.md`
- `schema.json` configuration schema

Finally run the quality checks:
```bash
pnpm lint && pnpm typecheck && pnpm test
```
