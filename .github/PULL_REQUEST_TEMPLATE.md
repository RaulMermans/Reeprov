## Description

<!-- Provide a concise description of the motivation and changes made in this PR -->

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking enhancement)
- [ ] Breaking change (fix or feature changing public API/contracts)
- [ ] Documentation update
- [ ] Release engineering / CI hardening

## Pre-Merge Quality Checklist

- [ ] All tests pass locally via `npm run ci`
- [ ] TypeScript types compile without errors (`npm run typecheck`)
- [ ] Linter checks pass (`npm run lint`)
- [ ] No network-dependent tests added to default CI
- [ ] Documentation updated (if applicable)

## Security & Privacy Checklist

- [ ] No secrets or tokens exposed to client-side code (`NEXT_PUBLIC_` prohibited for secrets)
- [ ] Route security inventory maintained for any new or modified API endpoints
- [ ] Scanned code and external traces treated strictly as untrusted evidence
- [ ] No private or absolute paths (`/Users/...`, `/home/...`) in code, tests, or documentation
- [ ] All test fixtures use synthetic, sanitized data only

## Public API Stability

- [ ] Interface classified: `PUBLIC` | `EXPERIMENTAL` | `INTERNAL` | `LEGACY`
- [ ] Backwards-compatibility verified for `PUBLIC` interfaces
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
