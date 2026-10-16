# Contributing to Reeprov

Thank you for your interest in contributing to Reeprov! Reeprov is local-first debugging and reproducibility infrastructure for external AI agents.

## Getting Started

### Prerequisites
- **Node.js**: `>=22` (required)
- **npm**: `>=10`
- **Git**
- Optional: Python `>=3.10` (if working on the Python client SDK)

### Development Setup
```bash
# Clone the repository
git clone https://github.com/RaulMermans/Reeprov.git
cd Reeprov

# Clean reproducible install
npm ci

# Start development studio
npm run dev
```

Studio will be available at `http://localhost:3000/dashboard` in `PERSONAL_LOCAL` mode.

---

## Continuous Integration & Quality Gates

Every pull request must pass the automated CI gate before merge:

```bash
npm run ci
```

`npm run ci` runs four strict checks sequentially:
1. `npm run lint` — ESLint rules with strict boundary checking.
2. `npm run typecheck` — TypeScript compiler checks (`tsc --noEmit`).
3. `npm run test` — Vitest unit & integration test suite (must run 100% offline).
4. `npm run build` — Next.js production build verification.

> [!IMPORTANT]
> **No Network-Dependent Tests:** Default CI tests must run offline with zero live external network or LLM API calls. Use deterministic mocks and synthetic fixtures.
> **Never Bypass Failing Tests:** Do not disable or comment out failing assertions.

---

## Architecture Orientation

A high-level understanding of the Reeprov pipeline:

```
External Agent (TypeScript / Python SDK / REST)
       ↓  (HTTP Ingest API: /api/runs/*, /api/traces/*)
Proof Layer / Ingest Controller
       ↓  (Secret Redaction & Schema Validation)
Canonical Evidence Store (.reeprov/ or Postgres)
       ↓
Replay & Fork Engine ←→ Diagnostic Run Diff ←→ Eval & Regression Gates
       ↓
Reeprov Studio (Next.js Dashboard) / Local CLI (`reeprov`)
```

- Complete architectural specifications are indexed in [docs/README.md](docs/README.md).
- Key design document: [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Public API & Stability Rules

When adding or modifying interfaces, classify them according to our stability taxonomy:
- **PUBLIC:** Guaranteed backwards-compatible within minor versions (HTTP Ingest, `@reeprov/client`, `reeprov-client`, `reeprov` CLI).
- **EXPERIMENTAL:** Subject to refinement across releases (e.g. advanced semantic evaluators, new memory ablation adapters).
- **INTERNAL:** Private server and studio components (`lib/core/*`, database helpers). Not exposed externally.
- **LEGACY:** Retained temporarily for backward compatibility with deprecation warnings (e.g. `pulse` CLI command, `AGENTPULSE_*` env fallbacks).

---

## Security Boundaries & Rules

1. **Server-Side Credentials Only:** Never expose tokens or secrets to client components. Never use `NEXT_PUBLIC_` for sensitive environment variables.
2. **Scanned Code Untrusted:** Reeprov never executes or imports code from scanned repositories or external agent runtimes.
3. **Route Security Parity:** Any newly added API route under `/app/api/` must be registered in the route security matrix and audited against mode-specific auth controls.
4. **No Private Absolute Paths:** Never commit absolute paths like `/Users/...` or `/home/...`. Use repository-relative links.
5. **Synthetic Fixtures Only:** Test fixtures and demo data must be strictly synthetic, sanitized, and free of real personal or operational secrets.

---

## How to Add Features

### Adding an Evaluator Adapter
Implement the evaluator interface defined in `lib/core/evals/` and register it in the eval registry. Add test coverage in `tests/` with synthetic datasets.

### Adding a Framework Adapter
Framework-specific adapters belong in community packages or `examples/integrations/`. Ensure they comply with the [Contributor Adapter Contract](docs/integrations/frameworks.md).

### Modifying Schema or Migrations
If updating database or trace schemas:
- Provide backward-compatible serialization where possible.
- Update migration scripts in `scripts/db-migrate.ts`.
- Document schema changes in `CHANGELOG.md`.

---

## Pull Request Guidelines

1. Create a feature branch from `main`: `git checkout -b feature/my-improvement`.
2. Follow the `.github/PULL_REQUEST_TEMPLATE.md` checklist.
3. Ensure `npm run ci` passes cleanly.
4. Update `CHANGELOG.md` under `[Unreleased]` or current beta section.

## Code of Conduct

All contributors and participants agree to abide by our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
