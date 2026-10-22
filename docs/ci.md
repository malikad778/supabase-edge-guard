# Continuous Integration (CI) Guide

`supabase-edge-guard` is built from the ground up to integrate seamlessly into modern CI/CD pipelines, security scanning tabs, and pull request review workflows.

---

## 1. Quick Setup: The `init` Command

You can scaffold a ready-to-run GitHub Action workflow and configuration file with one command:

```bash
npx supabase-edge-guard init
```

This writes:
1. `supabase-edge-guard.config.json` with recommended defaults.
2. `.github/workflows/edge-guard.yml` configured for PR scanning.
3. If `.husky` exists in your repository, it adds a pre-commit check: `npx supabase-edge-guard --changed-only --fail-on error`.

---

## 2. GitHub Actions Integration

The official composite GitHub Action is defined in `action.yml`. It handles:
- Running the scanner and producing SARIF 2.1.0 output.
- Uploading SARIF findings to the **GitHub Code Scanning** (Security) tab via `@github/codeql-action/upload-sarif`.
- Posting or updating a single **sticky PR comment** summarizing results and security grade.
- Enforcing your `--fail-on` threshold to pass or fail the pull request.

### Example Workflow: `.github/workflows/edge-guard.yml`

```yaml
name: Supabase Edge Guard
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write  # required for SARIF upload
  pull-requests: write    # required for sticky PR comment

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: malikad778/supabase-edge-guard@v0
        with:
          fail-on: error
          upload-sarif: 'true'
          comment: 'true'
          changed-only: 'false'
```

### Action Inputs Reference

| Input | Description | Default |
|---|---|---|
| `path` | Project directory to scan | `.` |
| `fail-on` | Severity threshold to fail the job: `error`, `warning`, `info`, `never` | `error` |
| `version` | Version of `supabase-edge-guard` to run (`latest` or specific version e.g. `0.2.0`) | `latest` |
| `upload-sarif` | Upload results to GitHub code scanning | `true` |
| `comment` | Post / update a sticky summary comment on pull requests | `true` |
| `changed-only` | Only report findings in files changed in this commit / PR | `false` |
| `github-token` | GitHub token for posting PR comments | `${{ github.token }}` |

---

## 3. Pull Request Sticky Comment

When `comment: 'true'`, the action detects existing comments containing the hidden identifier `<!-- supabase-edge-guard -->`. It updates the existing comment in-place on new commits rather than creating noisy new comment threads.

The comment includes:
- Security Score and letter grade (`A`–`F`).
- Breakdown of errors, warnings, and informational findings.
- Detailed expandable sections for each failing rule with remediation steps.

---

## 4. GitHub Code Scanning (SARIF)

The generated SARIF report strictly adheres to the **SARIF 2.1.0** specification. Findings show up natively in your GitHub repository's **Security > Code scanning alerts** tab, complete with:
- Exact file paths, lines, and columns.
- Deep links to rule documentation.
- Unique fingerprints matching baselines.

---

## 5. Pre-Commit Hooks (Husky / lint-staged)

Run rapid scans before code is committed using `--changed-only`:

```json
// package.json (with lint-staged)
{
  "lint-staged": {
    "*.{ts,tsx,sql}": [
      "supabase-edge-guard --changed-only --fail-on error"
    ]
  }
}
```

Or directly in `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx supabase-edge-guard --changed-only --fail-on error
```

---

## 6. Other CI Systems (GitLab CI, CircleCI, Bitbucket)

`supabase-edge-guard` can be run in any environment with Node >= 18.17:

### GitLab CI (`.gitlab-ci.yml`)

```yaml
supabase-edge-guard:
  image: node:20
  stage: test
  script:
    - npx -y supabase-edge-guard --fail-on error
```

### Exit Codes Reference

| Exit Code | Meaning |
|---|---|
| `0` | Scan completed successfully with zero findings at or above `--fail-on`. |
| `1` | One or more findings met or exceeded `--fail-on` (default: `error`). |
| `2` | Configuration error, invalid CLI flags, or file system access error. |
