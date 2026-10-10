/**
 * Deterministic Network Kill Switch for STRICT_OFFLINE Replay.
 *
 * Intercepts and denies all outbound network traffic (fetch, http, https)
 * during offline replay. Ensures network_attempts === 0.
 */

import http from "node:http";
import https from "node:https";

export class NetworkAccessDeniedError extends Error {
  constructor(public readonly target: string) {
    super(
      `[STRICT_OFFLINE Network Kill Switch] Outbound network request to '${target}' was blocked. Offline replay forbids all external network calls.`
    );
    this.name = "NetworkAccessDeniedError";
  }
}

export class NetworkKillSwitch {
  private active = false;
  private attemptCount = 0;
  private blockedTargets: string[] = [];

  private originalFetch: typeof globalThis.fetch | null = null;
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpGet: typeof http.get | null = null;
  private originalHttpsRequest: typeof https.request | null = null;
  private originalHttpsGet: typeof https.get | null = null;

  activate(): void {
    if (this.active) return;
    this.active = true;

    // 1. Intercept global fetch
    if (typeof globalThis.fetch === "function") {
      this.originalFetch = globalThis.fetch;
      globalThis.fetch = (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        this.attemptCount++;
        const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        this.blockedTargets.push(target);
        throw new NetworkAccessDeniedError(target);
      };
    }

    // 2. Intercept http.request and http.get
    this.originalHttpRequest = http.request;
    this.originalHttpGet = http.get;
    const blockedHttp = (urlOrOptions: unknown): never => {
      this.attemptCount++;
      const target = typeof urlOrOptions === "string" ? urlOrOptions : JSON.stringify(urlOrOptions);
      this.blockedTargets.push(target);
      throw new NetworkAccessDeniedError(target);
    };
    (http as unknown as { request: unknown }).request = blockedHttp;
    (http as unknown as { get: unknown }).get = blockedHttp;

    // 3. Intercept https.request and https.get
    this.originalHttpsRequest = https.request;
    this.originalHttpsGet = https.get;
    const blockedHttps = (urlOrOptions: unknown): never => {
      this.attemptCount++;
      const target = typeof urlOrOptions === "string" ? urlOrOptions : JSON.stringify(urlOrOptions);
      this.blockedTargets.push(target);
      throw new NetworkAccessDeniedError(target);
    };
    (https as unknown as { request: unknown }).request = blockedHttps;
    (https as unknown as { get: unknown }).get = blockedHttps;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    if (this.originalHttpRequest) {
      http.request = this.originalHttpRequest;
      this.originalHttpRequest = null;
    }
    if (this.originalHttpGet) {
      http.get = this.originalHttpGet;
      this.originalHttpGet = null;
    }
    if (this.originalHttpsRequest) {
      https.request = this.originalHttpsRequest;
      this.originalHttpsRequest = null;
    }
    if (this.originalHttpsGet) {
      https.get = this.originalHttpsGet;
      this.originalHttpsGet = null;
    }
  }

  async runWithKillSwitch<T>(fn: () => Promise<T>): Promise<T> {
    this.activate();
    try {
      return await fn();
    } finally {
      this.deactivate();
    }
  }

  getAttemptCount(): number {
    return this.attemptCount;
  }

  getBlockedTargets(): string[] {
    return [...this.blockedTargets];
  }

  reset(): void {
    this.attemptCount = 0;
    this.blockedTargets = [];
  }
}

export const defaultNetworkKillSwitch = new NetworkKillSwitch();
