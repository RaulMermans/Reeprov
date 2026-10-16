const SESSION_KEY = "reeprov_access_key";
const LEGACY_SESSION_KEY = "agentpulse_access_key";

export function getInternalKey(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(LEGACY_SESSION_KEY);
}

export function setInternalKey(key: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, key);
}

export function clearInternalKey(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
}

export function isInternalUnlocked(): boolean {
  return Boolean(getInternalKey());
}

export function mergeAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const key = getInternalKey();
  return key ? { "x-reeprov-key": key, "x-agentpulse-key": key, ...extra } : { ...extra };
}
