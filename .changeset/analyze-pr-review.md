---
"awaitly-analyze": minor
---

Add `awaitly-analyze review` and a GitHub Action (`uses: jagreehal/awaitly@analyze-v0`). The review covers every workflow a change touched: a structural diff, removed steps and blocks, new doctor findings, error type changes and a railway diagram of the new version. It posts one sticky PR comment with a merge-risk verdict and writes the same report to the job summary. Run it locally with `awaitly-analyze review --base origin/main`.
