# Architecture: Operating & Deployment Modes

Reeprov defines exactly three discrete operating modes governed by `lib/auth/operatingMode.ts`.

## Mode Specification

| Mode Name | Environment Variable | Host Binding | Auth Mechanism | Primary Target |
|:---|:---|:---|:---|:---|
| **PERSONAL_LOCAL** (default) | `REEPROV_MODE=personal_local` or unset | `127.0.0.1` / `::1` only | Implicit via loopback interface | Local developer workstation |
| **PRIVATE_SELF_HOSTED** | `REEPROV_MODE=self_hosted` | `0.0.0.0` or private IP | HttpOnly session or instance access key | Team server, VM, Docker |
| **HEADLESS_CI** | `REEPROV_MODE=headless_ci` | Any | Loopback or CI token / access key | GitHub Actions, GitLab CI |

## Mode Resolution

The active mode is resolved deterministically at runtime via `getOperatingMode()`:

```typescript
export function getOperatingMode(): OperatingMode {
  const raw = process.env.REEPROV_MODE?.toLowerCase().trim();
  if (raw === "self_hosted" || raw === "private_self_hosted") return "self_hosted";
  if (raw === "headless_ci" || raw === "ci" || raw === "headless") return "headless_ci";
  return "personal_local";
}
```

## Host Binding Validation

Before launching or serving requests, `validateHostBinding(host, mode)` enforces that `personal_local` mode never binds to public interfaces (`0.0.0.0`, `::`, or external network interfaces).
