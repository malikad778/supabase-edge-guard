# Architecture

```
file-discovery ─┬─ SQL files ──► tokenizer → splitter → parse-* → schema-index (replay in filename order)
                ├─ TS files  ──► boundary + import graph (all files) → ts-morph (keyword-filtered files)
                └─ toml / .env / .gitignore
                              ▼
                        ProjectContext ──► rules (pure: ctx → Finding[]) ──► suppressions → baseline → changed-only
                                                                        ▼
                                                               reporters / fix engine
```

Key decisions
- **Masking, not parsing, for SQL expressions.** Comments and string interiors are replaced with spaces of equal length, so regexes never match inside them and offsets stay valid for exact text edits.
- **Boundaries.** `classifyBoundaryText` assigns client / server / edge / middleware from path, directives (`'use client'`, `'use server'`) and `createServerFn`. Function-level `'use server'` and `createServerFn` handlers override the file boundary.
- **Client reachability.** BFS over a regex-free import graph (`ts.preProcessFile`) from client files; server, edge and middleware modules are never traversed because they cannot end up in the browser bundle. Type-only imports are ignored.
- **Fixes are data.** A rule returns `Fix { edits, newFiles }`; `fixes/apply.ts` owns validation, overlap detection, migration merging and writing.
- **Rules never read disk.** Everything they need is in `ProjectContext`.
