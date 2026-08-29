---
name: review
description: Run an adversarial review of the latest changes and return a prioritized verdict
---

Review the current state of the repo for correctness and regressions.
Run any available checks (typecheck, tests) if safe.
Return a verdict: APPROVED or CHANGES REQUIRED, then a prioritized list
(P0 blocking, P1 important, P2 minor) with one-line evidence each.
