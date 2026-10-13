import { describe, expect, it } from "vitest";
import { validateHostBinding } from "../operatingMode";

describe("Process Host Binding Enforcement (Sprint Item 27)", () => {
  it("1. personal_local + 127.0.0.1 → valid", () => {
    const res = validateHostBinding("127.0.0.1", "personal_local");
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("2. personal_local + ::1 → valid", () => {
    const res = validateHostBinding("::1", "personal_local");
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("3. personal_local + localhost → valid", () => {
    const res = validateHostBinding("localhost", "personal_local");
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("4. personal_local + 0.0.0.0 → invalid (rejected)", () => {
    const res = validateHostBinding("0.0.0.0", "personal_local");
    expect(res.valid).toBe(false);
    expect(res.reason).toBeDefined();
    expect(res.reason).toContain("Loopback privacy guarantee");
    expect(res.reason).toContain("0.0.0.0");
  });

  it("5. personal_local + :: → invalid (rejected)", () => {
    const res = validateHostBinding("::", "personal_local");
    expect(res.valid).toBe(false);
    expect(res.reason).toBeDefined();
    expect(res.reason).toContain("Loopback privacy guarantee");
  });

  it("6. personal_local + 192.168.1.1 → invalid (rejected)", () => {
    const res = validateHostBinding("192.168.1.1", "personal_local");
    expect(res.valid).toBe(false);
    expect(res.reason).toBeDefined();
    expect(res.reason).toContain("Loopback privacy guarantee");
    expect(res.reason).toContain("192.168.1.1");
  });

  it("7. self_hosted + 0.0.0.0 → valid (allowed with auth)", () => {
    const res = validateHostBinding("0.0.0.0", "self_hosted");
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("8. headless_ci + 127.0.0.1 → valid", () => {
    const res = validateHostBinding("127.0.0.1", "headless_ci");
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("personal_local rejects other public IPv4 addresses", () => {
    expect(validateHostBinding("10.0.0.1", "personal_local").valid).toBe(false);
    expect(validateHostBinding("172.16.0.1", "personal_local").valid).toBe(false);
    expect(validateHostBinding("8.8.8.8", "personal_local").valid).toBe(false);
  });

  it("personal_local allows all 127.0.0.0/8 loopback range addresses", () => {
    expect(validateHostBinding("127.0.0.2", "personal_local").valid).toBe(true);
    expect(validateHostBinding("127.1.2.3", "personal_local").valid).toBe(true);
  });

  it("self_hosted and headless_ci allow remote and loopback addresses", () => {
    expect(validateHostBinding("192.168.1.50", "self_hosted").valid).toBe(true);
    expect(validateHostBinding("127.0.0.1", "self_hosted").valid).toBe(true);
    expect(validateHostBinding("0.0.0.0", "headless_ci").valid).toBe(true);
  });
});
