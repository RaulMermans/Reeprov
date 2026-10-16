# Architecture: Local Data Storage Layout

Reeprov persists its data locally using structured subdirectories under a dedicated home path, managed by `lib/storage/dataPath.ts`.

## Root Path Resolution

The root storage directory is resolved via `getReeprovHome()`:

1. `REEPROV_STORE_DIR` environment variable (if specified).
2. Default fallback: `~/.reeprov/` in the user's home directory.

## Subdirectory Hierarchy

The storage layout organizes artifacts into specialized directories:

```text
~/.reeprov/
├── reeprov.db         # SQLite database storing projects, runs, and metadata
├── runs/                 # Canonical run evidence envelopes (*.json)
├── comparisons/          # Precomputed run comparisons and semantic diffs
├── blobs/                # Compressed binary and state payload blobs
├── evals/                # Eval datasets, metric definitions, and eval run records
├── baselines/            # Certified golden run baselines for regression gates
└── backups/              # Scheduled and pre-deletion project backups
```

## Git Safety Guard

All paths under `.reeprov/`, `*.db`, `*.sqlite`, and credentials files are declared in `.gitignore` to guarantee local data is never committed to version control.
