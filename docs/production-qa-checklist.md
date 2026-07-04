# Production QA Checklist

Primary fixture:

- Run ID: `910b2ce1-be0b-49e6-9dd1-eb1cc1b6976a`
- Run page: `https://agent-pulse-alpha.vercel.app/dashboard/runs/910b2ce1-be0b-49e6-9dd1-eb1cc1b6976a`

## Smoke Checks

- `GET /api/health` returns `ok: true`, `environment: "production"`, and the expected version or commit hash.
- `GET /api/storage/health` returns healthy storage status. Include the configured access key when the endpoint is protected.
- The real run page loads without client or server errors.
- The Workflow tab loads.
- Raw Trace remains accessible.

## Visual Execution Canvas

- Default canvas zoom is readable on a normal laptop viewport.
- The first 2-4 workflow stages are visible and understandable without manual zoom.
- Fit-view control still shows the full graph.
- Pan and zoom work.
- Minimap is visible, useful at default zoom, and does not cover important controls.
- Legend opens and collapses.
- Replay controls play, pause, reset, step, and scrub.
- Live/replay follow keeps the active node visible when enabled.
- Paused follow does not stop data refresh or replay data updates.
- Filters update visible evidence and graph paths.
- Clicking a stage node opens the inspector.
- Clicking an evidence node opens the inspector.
- No edit, run, execute, or workflow mutation controls appear.
- Legacy graph fallback works if retained.
