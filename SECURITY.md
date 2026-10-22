# Security policy

## Reporting a vulnerability
Please do **not** open a public issue. Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). You can expect an acknowledgement within a few days.

## Scope
supabase-edge-guard is a local static analyzer: it reads files and never makes network requests. Relevant reports include
code execution via crafted project files, path traversal in `--fix`, or unsafe handling of untrusted repositories.
Findings about *missed detections* are accuracy issues, not vulnerabilities; please file those as regular issues.
