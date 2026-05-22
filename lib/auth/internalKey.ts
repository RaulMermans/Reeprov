const SESSION_KEY = "agentpulse_access_key";

export function getInternalKey(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

export function setInternalKey(key: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, key);
}

export function clearInternalKey(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function isInternalUnlocked(): boolean {
  return Boolean(getInternalKey());
}

export function mergeAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const key = getInternalKey();
  return key ? { "x-agentpulse-key": key, ...extra } : { ...extra };
}
