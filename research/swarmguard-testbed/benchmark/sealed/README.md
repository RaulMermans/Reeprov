# Independently sealed evaluation packs

The 16 in-tree held-out cases in `p3.benchmark.v1` were published in PR #27 (`3912ffe`). Their labels are in git history. They are **not** a blind H1 test.

For new private evaluation cases:

1. Copy `example.sealed.json` to a file that is **not** committed (gitignore: `*.private.json`).
2. Fill injection plans and oracle labels offline.
3. Score with:

```bash
export REEPROV_P3_SEALED_EVALUATION_PATH=/absolute/path/to/pack.private.json
export REEPROV_P3_ALLOW_HELDOUT=1
npx tsx research/swarmguard-testbed/scripts/run.ts run --case your-sealed-id
```

4. Record only `integrity_hash` (SHA-256 of the canonical pack) in public notes. Do not commit labels.

Detector-role workspaces must set `REEPROV_P3_DETECTOR_ROLE=1`, which refuses this path.
