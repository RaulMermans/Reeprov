"use client";

import { useCallback, useEffect, useState } from "react";
import { NavBar } from "@/components/layout/NavBar";
import { DashboardAuthContext } from "@/lib/auth/dashboardAuthContext";
import { clearInternalKey, getInternalKey, setInternalKey } from "@/lib/auth/internalKey";
import type { FormEvent } from "react";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);
  const [operatingMode, setOperatingMode] = useState<string>("personal_local");

  // On mount: check operating mode and session state
  useEffect(() => {
    async function init() {
      setRevalidating(true);
      try {
        const sessionRes = await fetch("/api/auth/session");
        if (sessionRes.ok) {
          const sessionData = (await sessionRes.json()) as {
            mode: string;
            requiresAuth: boolean;
            authenticated: boolean;
          };
          setOperatingMode(sessionData.mode);

          // In PERSONAL_LOCAL mode, never show a lock screen
          if (sessionData.mode === "personal_local" || !sessionData.requiresAuth) {
            setIsUnlocked(true);
            setMounted(true);
            setRevalidating(false);
            return;
          }

          // If session cookie is already valid
          if (sessionData.authenticated) {
            setIsUnlocked(true);
            setMounted(true);
            setRevalidating(false);
            return;
          }
        }

        // Check fallback stored key in sessionStorage (backward compatibility)
        const stored = getInternalKey();
        if (stored) {
          const response = await fetch("/api/auth/validate", {
            method: "POST",
            headers: { "x-reeprov-key": stored },
          });

          if (response.ok) {
            setIsUnlocked(true);
          } else {
            clearInternalKey();
            setExpiredMessage("Access key expired or invalid. Please unlock again.");
          }
        }
      } catch {
        // Fallback: check stored key
        const stored = getInternalKey();
        if (stored) {
          setIsUnlocked(true);
        }
      } finally {
        setRevalidating(false);
        setMounted(true);
      }
    }

    void init();
  }, []);

  const lock = useCallback(async () => {
    try {
      await fetch("/api/auth/lock", { method: "POST" });
    } catch {
      // ignore
    }
    clearInternalKey();
    setIsUnlocked(false);
    setKeyInput("");
    setError(null);
    setExpiredMessage(null);
  }, []);

  const onUnauthorized = useCallback((message?: string) => {
    clearInternalKey();
    setIsUnlocked(false);
    setKeyInput("");
    setError(null);
    setExpiredMessage(message ?? "Access key expired or invalid. Please unlock again.");
  }, []);

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = keyInput.trim();

    if (!trimmed) {
      setError("Enter your Reeprov access key.");
      return;
    }

    setValidating(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reeprov-key": trimmed,
        },
        body: JSON.stringify({ accessKey: trimmed }),
      });

      if (response.status === 401) {
        setError("Invalid access key.");
        return;
      }

      if (!response.ok) {
        // Fallback verification via /api/auth/validate
        const valRes = await fetch("/api/auth/validate", {
          method: "POST",
          headers: { "x-reeprov-key": trimmed },
        });
        if (!valRes.ok) {
          setError("Could not validate access key.");
          return;
        }
      }

      // Do not store raw access key in sessionStorage; HttpOnly session cookie is the credential
      void setInternalKey;
      setIsUnlocked(true);
      setError(null);
      setExpiredMessage(null);
    } catch {
      setError("Could not validate access key.");
    } finally {
      setValidating(false);
    }
  }

  // Pre-mount or revalidating: show neutral loading skeleton.
  if (!mounted || revalidating) {
    return (
      <div className="min-h-screen bg-[#f7f8fb]">
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <span className="text-sm font-bold tracking-tight text-slate-950">Reeprov</span>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-20">
          <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  // Not unlocked: show self-hosted access gate (no navbar, no page content).
  if (!isUnlocked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fb] px-4">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-950">Reeprov</span>
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
              {operatingMode === "self_hosted" ? "Private Self-Hosted" : "Protected"}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Dashboard access — instance operator access gate</p>
        </div>

        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="flex flex-col gap-5" onSubmit={handleUnlock}>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Unlock instance</h2>
              <p className="mt-1 text-sm text-slate-500">
                Enter your{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs text-slate-700">
                  REEPROV_ACCESS_KEY
                </code>{" "}
                to unlock this private instance. An encrypted HttpOnly session cookie will be issued.
              </p>
            </div>

            {expiredMessage ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {expiredMessage}
              </div>
            ) : null}

            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700" htmlFor="dashboard-access-key">
              Access key
              <input
                autoComplete="off"
                autoFocus
                className="min-h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
                id="dashboard-access-key"
                onChange={(e) => setKeyInput(e.target.value)}
                type="password"
                value={keyInput}
              />
            </label>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={validating}
              type="submit"
            >
              {validating ? "Unlocking…" : "Unlock Dashboard"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Unlocked: render shell with full nav and content.
  return (
    <DashboardAuthContext.Provider value={{ isUnlocked: true, lock, onUnauthorized }}>
      <div className="min-h-screen bg-[#f7f8fb] text-slate-900">
        <NavBar onLock={lock} />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </DashboardAuthContext.Provider>
  );
}
