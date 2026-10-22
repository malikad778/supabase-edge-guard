# False-positive policy

- A rule that cannot be confident stays silent.
- Every suppression needs a written reason; reasons are visible in code review.
- If you find a false positive, open an issue with the minimal code. Accepted reports become regression tests in `tests/rules/`.
- Rules documented as advisory (SG006 info, SG011, SG015) are intentionally low-severity.
