/**
 * Shared two-agent incident handoff used by tests and the live runner.
 * Re-exports the capture harness so the example stays aligned with production capture.
 */
export {
  RESOLVER_AGENT_ID,
  TRIAGE_AGENT_ID,
  lookupIncidentTicket,
  runTwoAgentIncidentHandoff,
} from "../../../lib/core/capture/multiAgentHandoff";
