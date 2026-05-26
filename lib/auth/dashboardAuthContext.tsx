"use client";

import { createContext, useContext } from "react";

export interface DashboardAuthContextValue {
  isUnlocked: boolean;
  lock: () => void;
  onUnauthorized: (message?: string) => void;
}

export const DashboardAuthContext = createContext<DashboardAuthContextValue>({
  isUnlocked: false,
  lock: () => {},
  onUnauthorized: () => {},
});

export function useDashboardAuth() {
  return useContext(DashboardAuthContext);
}
