import { describe, expect, it } from "vitest";
import { mockReport } from "@/lib/reports/buildReport";
import { getInternalKey, mergeAuthHeaders, setInternalKey, clearInternalKey, isInternalUnlocked } from "@/lib/auth/internalKey";

describe("Task 2A — two-mode product structure", () => {
  describe("mockReport produces a valid initial report for ScannerPage", () => {
    it("returns a ScanReport with required fields", async () => {
      const report = await mockReport();
      expect(report.repoName).toBeTruthy();
      expect(report.reportVersion).toBe("2.0");
      expect(Array.isArray(report.findings)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.scores).toBeTruthy();
    });

    it("has a scanSource with type mock", async () => {
      const report = await mockReport();
      expect(report.scanSource?.type).toBe("mock");
    });
  });

  describe("internalKey module guards against non-browser environment", () => {
    it("getInternalKey returns null without window", () => {
      expect(getInternalKey()).toBeNull();
    });

    it("setInternalKey is a no-op without window", () => {
      expect(() => setInternalKey("test")).not.toThrow();
    });

    it("clearInternalKey is a no-op without window", () => {
      expect(() => clearInternalKey()).not.toThrow();
    });

    it("isInternalUnlocked returns false without window", () => {
      expect(isInternalUnlocked()).toBe(false);
    });

    it("mergeAuthHeaders returns only extra headers without a key", () => {
      const headers = mergeAuthHeaders({ Accept: "application/json" });
      expect(headers).toEqual({ Accept: "application/json" });
    });
  });
});
