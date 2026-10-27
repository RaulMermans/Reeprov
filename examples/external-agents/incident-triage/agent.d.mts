import type { HostDependencies, ReeprovClient } from "@reeprov/client";

export declare function createLiveDependencies(outboxDir: string): HostDependencies;
export declare function runIncidentTriage(options: {
  client: ReeprovClient;
  outboxDir: string;
  runId?: string;
  contentMode?: "STRUCTURE_ONLY" | "SAFE_CONTENT" | "FULL_CONTENT";
  metricsCredential?: string;
  input?: { incident_id: string };
}): Promise<{ run_id: string; output: Record<string, unknown>; acks: Array<{ ok: boolean; status?: string; code?: string }> }>;
