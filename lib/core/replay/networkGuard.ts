/**
 * Application-level interception for offline replay.
 *
 * This is defense in depth for known Node APIs, not an OS network sandbox.
 * Arbitrary host code must run in a separately network-isolated process if a
 * comprehensive zero-egress guarantee is required.
 */

import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export class NetworkAccessDeniedError extends Error {
  constructor(public readonly target: string) {
    super(`[STRICT_OFFLINE Network Guard] '${target}' was blocked by the application-level replay guard.`);
    this.name = "NetworkAccessDeniedError";
  }
}

interface PatchedMethod {
  target: Record<string, unknown>;
  name: string;
  original: unknown;
}

export class NetworkKillSwitch {
  private static owner: NetworkKillSwitch | null = null;
  private active = false;
  private attemptCount = 0;
  private blockedTargets: string[] = [];
  private patches: PatchedMethod[] = [];

  private block(target: string): never {
    this.attemptCount++;
    // Record the API name, not raw URLs or command arguments that may contain secrets.
    this.blockedTargets.push(target);
    throw new NetworkAccessDeniedError(target);
  }

  private patch(target: object, name: string, label: string): void {
    const methods = target as Record<string, unknown>;
    if (typeof methods[name] !== "function") return;
    const original = methods[name];
    methods[name] = (..._args: unknown[]) => this.block(label);
    this.patches.push({ target: methods, name, original });
  }

  activate(): void {
    if (this.active) return;
    if (NetworkKillSwitch.owner) {
      throw new Error("A process-wide replay network guard is already active");
    }
    NetworkKillSwitch.owner = this;
    try {
      this.patch(globalThis, "fetch", "fetch");
      for (const name of ["request", "get"]) {
        this.patch(http, name, `http.${name}`);
        this.patch(https, name, `https.${name}`);
      }
      for (const name of ["connect", "createConnection"]) {
        this.patch(net, name, `net.${name}`);
      }
      this.patch(net.Socket.prototype, "connect", "net.Socket.connect");
      this.patch(tls, "connect", "tls.connect");
      this.patch(dgram, "createSocket", "dgram.createSocket");
      for (const name of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "reverse"]) {
        this.patch(dns, name, `dns.${name}`);
      }
      for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
        this.patch(childProcess, name, `child_process.${name}`);
      }
      this.active = true;
    } catch (error) {
      this.restore();
      NetworkKillSwitch.owner = null;
      throw error;
    }
  }

  private restore(): void {
    for (const { target, name, original } of this.patches.reverse()) {
      target[name] = original;
    }
    this.patches = [];
  }

  deactivate(): void {
    if (!this.active) return;
    this.restore();
    this.active = false;
    NetworkKillSwitch.owner = null;
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
