/**
 * AgentPulse Operating Modes & Loopback Privacy Guarantee.
 *
 * Exactly three operating modes:
 *   1. PERSONAL_LOCAL (default)   — Single operator, local data, loopback bound (127.0.0.1 / ::1),
 *                                   no login screen, no user accounts.
 *   2. PRIVATE_SELF_HOSTED        — Private server (HALO, VM, Docker), mandatory instance authentication,
 *                                   single instance-owner model, bounded HttpOnly session.
 *   3. HEADLESS_CI                — CI/CD pipelines, no Studio dependency, CLI/API credentials.
 */

export type OperatingMode = "personal_local" | "self_hosted" | "headless_ci";

/**
 * Resolves the active operating mode from the environment.
 * Defaults to PERSONAL_LOCAL.
 */
export function getOperatingMode(): OperatingMode {
  const raw = process.env.AGENTPULSE_MODE?.toLowerCase().trim();
  if (raw === "self_hosted" || raw === "private_self_hosted") {
    return "self_hosted";
  }
  if (raw === "headless_ci" || raw === "ci" || raw === "headless") {
    return "headless_ci";
  }
  return "personal_local";
}

/**
 * Checks whether an IP address is a local loopback address.
 * Covers IPv4 (127.0.0.0/8), IPv6 (::1), IPv4-mapped IPv6 (::ffff:127.x.x.x), and localhost.
 */
export function isLoopbackAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();

  // Direct IPv6 loopback
  if (normalized === "::1" || normalized === "[::1]") {
    return true;
  }

  // Bracketed IPv6 with port, e.g. [::1]:3000
  if (normalized.startsWith("[::1]:")) {
    return true;
  }

  // Strip port if IPv4 (e.g., 127.0.0.1:3000) or bracketed IPv6
  let host = normalized;
  if (normalized.startsWith("[") && normalized.includes("]")) {
    host = normalized.slice(1, normalized.indexOf("]"));
  } else if (!normalized.includes("::") && normalized.includes(":")) {
    // IPv4 with port: only 1 colon
    const colonCount = (normalized.match(/:/g) || []).length;
    if (colonCount === 1) {
      host = normalized.split(":")[0];
    }
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return true;
  }

  // IPv4 loopback range 127.0.0.0/8
  if (host.startsWith("127.")) {
    return true;
  }

  // IPv4-mapped IPv6 loopback (e.g. ::ffff:127.0.0.1)
  if (normalized.startsWith("::ffff:127.") || normalized === "::ffff:7f00:1") {
    return true;
  }

  return false;
}

/**
 * Checks whether an incoming HTTP request originates from a local loopback interface.
 */
export function isLoopbackRequest(request: Request): boolean {
  // If host header points to localhost or 127.0.0.1
  const hostHeader = request.headers.get("host") || "";
  const hostName = hostHeader.split(":")[0]?.toLowerCase();
  const isLocalHost = hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1" || hostName?.startsWith("127.");

  // Check client IP headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  const clientIp = (forwardedFor ? forwardedFor.split(",")[0]?.trim() : null) || realIp;

  if (clientIp) {
    return isLoopbackAddress(clientIp);
  }

  // Fallback to URL hostname if no IP headers provided
  try {
    const url = new URL(request.url);
    if (isLoopbackAddress(url.hostname)) {
      return true;
    }
  } catch {
    // ignore URL parse errors
  }

  return isLocalHost;
}

/**
 * Enforces loopback binding for PERSONAL_LOCAL mode.
 * Throws or returns an error string if personal_local is bound to a public interface.
 */
export function validateHostBinding(host: string, mode: OperatingMode): { valid: boolean; reason?: string } {
  if (mode === "personal_local") {
    if (host === "0.0.0.0" || host === "::" || host === "") {
      return {
        valid: false,
        reason: "Loopback privacy guarantee: PERSONAL_LOCAL must bind only to loopback (127.0.0.1 or ::1). Exposing 0.0.0.0 requires AGENTPULSE_MODE=self_hosted with authentication.",
      };
    }
    if (!isLoopbackAddress(host)) {
      return {
        valid: false,
        reason: `Loopback privacy guarantee: Host '${host}' is not a loopback interface. In PERSONAL_LOCAL mode, only 127.0.0.1 and ::1 are permitted.`,
      };
    }
  }
  return { valid: true };
}
