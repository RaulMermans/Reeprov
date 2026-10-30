export * from "./contracts";
export * from "./modes";
export * from "./budget";
export * from "./isolation";
export * from "./injection";
export * from "./state";
export * from "./tools";
export * from "./llm";
export * from "./domain";
export * from "./harness";
export * from "./persist";
export * from "./detector";
export * from "./observability";
export * from "./baselines";
export * from "./evaluate";
export * from "./benchmark";
export * from "./experiment";
export * from "./oracle";
export * from "./heldoutAccess";
export * from "./sealed";

import { investigationDomain } from "../domains/investigation";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import type { DomainModule } from "./domain";

export { investigationDomain, softwareEngineeringDomain };

export const DOMAIN_MODULES: Record<string, DomainModule> = {
  [softwareEngineeringDomain.id]: softwareEngineeringDomain,
  se: softwareEngineeringDomain,
  [investigationDomain.id]: investigationDomain,
  inv: investigationDomain,
};

export function getDomain(id: string): DomainModule {
  const domain = DOMAIN_MODULES[id];
  if (!domain) {
    throw new Error(`Unknown experimental domain "${id}". Known: software-engineering, investigation.`);
  }
  return domain;
}
