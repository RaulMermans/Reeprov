"use client";

/**
 * Live run polling — refetches GET /api/runs/[runId] on an interval while a
 * run is non-terminal, so the Visual Execution Canvas can update as new
 * trace events arrive. Reuses the existing run detail route rather than
 * adding a new endpoint: it already returns the full run + trace events +
 * tool calls + eval results, and duplicate event_ids are deduped at
 * ingestion, so a full refetch is simpler and safer than merging deltas.
 *
 * This hook never mutates run data — it only refetches and hands the fresh
 * payload to the caller, which re-derives all visual state from it.
 */

import { useEffect, useRef } from "react";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { SavedRun } from "@/lib/runs/runTypes";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["completed", "failed", "degraded"]);

export type LiveRunPollingPayload = SavedRun & { derivedSummary?: unknown };

export interface UseLiveRunPollingParams {
  runId: string;
  /** Poll only while true — callers should gate this on run status being non-terminal. */
  enabled: boolean;
  onUpdate: (data: LiveRunPollingPayload) => void;
  onUnauthorized: () => void;
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function useLiveRunPolling({ runId, enabled, onUpdate, onUnauthorized }: UseLiveRunPollingParams): void {
  const onUpdateRef = useRef(onUpdate);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUpdateRef.current = onUpdate;
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!enabled || !runId) return;

    let cancelled = false;
    let timeoutId: number | undefined;

    function scheduleNext() {
      if (cancelled) return;
      timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
    }

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}`, { headers: mergeAuthHeaders() });
        if (cancelled) return;

        if (res.status === 401) {
          onUnauthorizedRef.current();
          return;
        }

        if (!res.ok) {
          scheduleNext();
          return;
        }

        const data = (await res.json()) as LiveRunPollingPayload;
        if (cancelled) return;
        onUpdateRef.current(data);

        if (!isTerminalRunStatus(data.runRecord.status)) {
          scheduleNext();
        }
      } catch {
        if (!cancelled) scheduleNext();
      }
    }

    scheduleNext();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [runId, enabled]);
}
