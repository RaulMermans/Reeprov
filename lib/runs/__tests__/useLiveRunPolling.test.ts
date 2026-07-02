/**
 * Tests for the live run polling terminal-status predicate.
 *
 * The polling hook itself is a client-only React effect (setTimeout chain +
 * fetch) with no React component test harness in this repo — its lifecycle
 * behavior (poll while running, stop on terminal, resume follow) is verified
 * manually via scripts/simulate-live-run.ts against a running dev server, per
 * the sprint's QA plan. This file covers the pure, exported predicate that
 * decides when polling should stop.
 */

import { describe, expect, it } from "vitest";
import { isTerminalRunStatus } from "@/lib/runs/useLiveRunPolling";

describe("isTerminalRunStatus", () => {
  it("treats completed, failed, and degraded as terminal", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("degraded")).toBe(true);
  });

  it("treats running and pending as non-terminal", () => {
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("pending")).toBe(false);
  });
});
