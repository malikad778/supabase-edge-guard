# Writing a rule

1. `pnpm new-rule SG019 MyRuleName ts` creates `src/rules/sg019-my-rule-name.ts` and a test stub, and registers it.
2. Fill in `meta` (summary, a *real* incident, bad/good examples, references).
3. Implement `check(ctx)`. Use `ctx.sql` (tables, policies, functions, grants, views, indexes, buckets), `ctx.ts` (files, calls, boundaries, client reachability), `ctx.supabaseConfig`, `ctx.envFiles`.
4. Report with `ctx.report({ ruleId, message, file, line, column })`. `message` is one sentence stating *what* and *why*. Attach `related` locations for cross-file findings and a `fix` when it can be applied mechanically.
5. Test the bad case, the good case and the edge cases. Add a case to `examples/` if the rule belongs in the demo, then update `tests/golden/*.json`.
6. `pnpm gen-docs`.

Guidelines: prefer false negatives; never mark a fix `safe` if it can change behaviour; `SecurityDefiner`-style fixes that need human judgement are `safe: false`.
