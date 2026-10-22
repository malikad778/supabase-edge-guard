# Contributing

Thanks for helping make Supabase apps safer.

## Ground rules
- **No network access** at scan time, and no new runtime dependencies without discussion.
- **Prefer false negatives over false positives.** A noisy rule gets disabled; a quiet one gets trusted.
- Every rule ships with: a bad fixture, a good fixture, edge cases, `meta.incident` describing a real failure, and regenerated docs.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`.

## Workflow
```bash
pnpm install
pnpm new-rule SG019 MyRuleName ts   # scaffolds src/rules/…, tests/rules/…, registers the rule
pnpm test && pnpm lint && pnpm typecheck
pnpm gen-docs                       # commit the regenerated docs/rules, README table and schema.json
```

The two projects in `examples/` are golden tests (`tests/golden/*.json`). If your change legitimately alters their findings, update the golden files **and explain why in the PR**.

## Reporting false positives
Use the *False positive / false negative* issue template with the smallest code that reproduces it.
