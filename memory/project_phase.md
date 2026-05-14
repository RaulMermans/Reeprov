---
name: project-phase
description: Current phase and commit status for AgentPulse
metadata:
  type: project
---

Commit 7 (scanner calibration + report semantics) is complete as of 2026-05-14.

**Why:** Real-world ZIP scans exposed calibration issues — DB URLs in README were high severity, CI workflows were counted as product workflows, tests were counted as evals, inferred agents were over-attributed.

**State:**
- 116 tests pass
- Lint, tsc, build all pass
- FileContext type added (production/test/docs/ci/example/config/migration)
- Secret severity calibrated by file context (README/test/example secrets no longer go to 0)
- detectedEvals = explicit AI evals only; detectedTests = software tests
- detectedCIWorkflows = CI pipeline files (separate from AI/product workflows)
- DetectedAgent/Workflow have source/confidence/evidenceReason
- Inferred agents show "Not mapped" for unlinked attributes

**Next commit:** Commit 8 — dashboard polish and scan report readability, or Tool Auditor if scan calibration is stable.

**How to apply:** When planning next work, start from Commit 8 scope. Scanner calibration is now solid — real-world scans should show reasonable security scores.
