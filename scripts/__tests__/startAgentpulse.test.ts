import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveLauncherConfig,
  resolveLauncherHost,
  resolveLauncherMode,
  resolveLauncherPort,
  validateLauncherConfig,
  resolveNextExecutable,
} from "../start-agentpulse";
import { register as instrumentationRegister } from "../../instrumentation";

describe("Mode-Aware Launcher (start-agentpulse)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPULSE_MODE;
    delete process.env.AGENTPULSE_HOST;
    delete process.env.AGENTPULSE_PORT;
    delete process.env.AGENTPULSE_ACCESS_KEY;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveLauncherMode", () => {
    it("defaults to personal_local when AGENTPULSE_MODE is not set", () => {
      expect(resolveLauncherMode({})).toBe("personal_local");
    });

    it("resolves self_hosted mode", () => {
      expect(resolveLauncherMode({ AGENTPULSE_MODE: "self_hosted" })).toBe("self_hosted");
      expect(resolveLauncherMode({ AGENTPULSE_MODE: "private_self_hosted" })).toBe("self_hosted");
    });

    it("resolves headless_ci mode", () => {
      expect(resolveLauncherMode({ AGENTPULSE_MODE: "headless_ci" })).toBe("headless_ci");
      expect(resolveLauncherMode({ AGENTPULSE_MODE: "ci" })).toBe("headless_ci");
      expect(resolveLauncherMode({ AGENTPULSE_MODE: "headless" })).toBe("headless_ci");
    });
  });

  describe("resolveLauncherHost", () => {
    it("defaults to 127.0.0.1 for personal_local mode", () => {
      expect(resolveLauncherHost("personal_local", {})).toBe("127.0.0.1");
    });

    it("defaults to 127.0.0.1 for headless_ci mode", () => {
      expect(resolveLauncherHost("headless_ci", {})).toBe("127.0.0.1");
    });

    it("defaults to 0.0.0.0 for self_hosted mode", () => {
      expect(resolveLauncherHost("self_hosted", {})).toBe("0.0.0.0");
    });

    it("honors AGENTPULSE_HOST when explicitly specified", () => {
      expect(resolveLauncherHost("personal_local", { AGENTPULSE_HOST: "127.0.0.2" })).toBe("127.0.0.2");
      expect(resolveLauncherHost("headless_ci", { AGENTPULSE_HOST: "0.0.0.0" })).toBe("0.0.0.0");
      expect(resolveLauncherHost("self_hosted", { AGENTPULSE_HOST: "10.0.0.5" })).toBe("10.0.0.5");
    });
  });

  describe("resolveLauncherPort", () => {
    it("defaults to 3000", () => {
      expect(resolveLauncherPort({})).toBe(3000);
    });

    it("reads PORT from env", () => {
      expect(resolveLauncherPort({ PORT: "8080" })).toBe(8080);
    });

    it("reads AGENTPULSE_PORT with priority over PORT", () => {
      expect(resolveLauncherPort({ AGENTPULSE_PORT: "4000", PORT: "8080" })).toBe(4000);
    });

    it("falls back to 3000 if invalid port string provided", () => {
      expect(resolveLauncherPort({ PORT: "invalid" })).toBe(3000);
      expect(resolveLauncherPort({ PORT: "-5" })).toBe(3000);
    });
  });

  describe("resolveLauncherConfig", () => {
    it("resolves default personal_local production config", () => {
      const config = resolveLauncherConfig({}, []);
      expect(config.mode).toBe("personal_local");
      expect(config.host).toBe("127.0.0.1");
      expect(config.port).toBe(3000);
      expect(config.isDev).toBe(false);
    });

    it("detects --dev flag in argv", () => {
      const config = resolveLauncherConfig({}, ["--dev"]);
      expect(config.isDev).toBe(true);
      expect(config.extraArgs).toEqual([]);
    });

    it("preserves extra arguments while stripping --dev", () => {
      const config = resolveLauncherConfig({}, ["--dev", "--turbo"]);
      expect(config.isDev).toBe(true);
      expect(config.extraArgs).toEqual(["--turbo"]);
    });
  });

  describe("validateLauncherConfig — PERSONAL_LOCAL policy", () => {
    it("passes validation with loopback 127.0.0.1", () => {
      const config = resolveLauncherConfig({ AGENTPULSE_MODE: "personal_local" }, []);
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("fails before startup when PERSONAL_LOCAL attempts to bind to 0.0.0.0", () => {
      const config = resolveLauncherConfig(
        { AGENTPULSE_MODE: "personal_local", AGENTPULSE_HOST: "0.0.0.0" },
        []
      );
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Loopback privacy guarantee");
      expect(result.error).toMatch(/Exposing 0\.0\.0\.0 requires (REEPROV|AGENTPULSE)_MODE=self_hosted/);
    });

    it("fails before startup when PERSONAL_LOCAL attempts to bind to public IP", () => {
      const config = resolveLauncherConfig(
        { AGENTPULSE_MODE: "personal_local", AGENTPULSE_HOST: "192.168.1.50" },
        []
      );
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Host '192.168.1.50' is not a loopback interface");
    });
  });

  describe("validateLauncherConfig — SELF_HOSTED policy (Task 4 fail closed)", () => {
    it("fails closed when AGENTPULSE_ACCESS_KEY is missing", () => {
      const config = resolveLauncherConfig({ AGENTPULSE_MODE: "self_hosted" }, []);
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(
        /PRIVATE_SELF_HOSTED mode requires (REEPROV|AGENTPULSE)_ACCESS_KEY\. Set this environment variable before starting\./
      );
    });

    it("fails closed when AGENTPULSE_ACCESS_KEY is only whitespace", () => {
      const config = resolveLauncherConfig(
        { AGENTPULSE_MODE: "self_hosted", AGENTPULSE_ACCESS_KEY: "   " },
        []
      );
      const result = validateLauncherConfig(config, { AGENTPULSE_ACCESS_KEY: "   " });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(
        /PRIVATE_SELF_HOSTED mode requires (REEPROV|AGENTPULSE)_ACCESS_KEY\. Set this environment variable before starting\./
      );
    });

    it("passes validation when AGENTPULSE_ACCESS_KEY is provided", () => {
      const config = resolveLauncherConfig(
        { AGENTPULSE_MODE: "self_hosted", AGENTPULSE_ACCESS_KEY: "secret-key-123" },
        []
      );
      const result = validateLauncherConfig(config, { AGENTPULSE_ACCESS_KEY: "secret-key-123" });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(config.host).toBe("0.0.0.0");
    });
  });

  describe("validateLauncherConfig — HEADLESS_CI policy (Task 5)", () => {
    it("logs that Studio is optional and proceeds", () => {
      const config = resolveLauncherConfig({ AGENTPULSE_MODE: "headless_ci" }, []);
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.logs).toContain(
        "HEADLESS_CI mode: Studio available but not required. CLI evals, comparisons, and regression gates can run via API."
      );
    });

    it("allows configurable host binding in HEADLESS_CI mode", () => {
      const config = resolveLauncherConfig(
        { AGENTPULSE_MODE: "headless_ci", AGENTPULSE_HOST: "0.0.0.0" },
        []
      );
      const result = validateLauncherConfig(config, {});
      expect(result.valid).toBe(true);
      expect(config.host).toBe("0.0.0.0");
    });
  });

  describe("resolveNextExecutable", () => {
    it("locates next executable in cwd or falls back to 'next'", () => {
      const exe = resolveNextExecutable(process.cwd());
      expect(exe).toBeDefined();
      expect(typeof exe).toBe("string");
    });
  });

  describe("instrumentation.ts register hook (Task 2)", () => {
    it("runs register without throwing in personal_local mode", async () => {
      process.env.REEPROV_MODE = "personal_local";
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(instrumentationRegister()).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Reeprov Instrumentation] Operating mode: personal_local")
      );

      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("warns when REEPROV_ACCESS_KEY is missing in self_hosted mode without throwing", async () => {
      process.env.REEPROV_MODE = "self_hosted";
      delete process.env.REEPROV_ACCESS_KEY;
      delete process.env.AGENTPULSE_ACCESS_KEY;
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(instrumentationRegister()).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PRIVATE_SELF_HOSTED mode requires REEPROV_ACCESS_KEY")
      );

      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("logs notice in headless_ci mode without throwing", async () => {
      process.env.REEPROV_MODE = "headless_ci";
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(instrumentationRegister()).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("HEADLESS_CI mode: Studio available but not required")
      );

      consoleLogSpy.mockRestore();
    });
  });
});
