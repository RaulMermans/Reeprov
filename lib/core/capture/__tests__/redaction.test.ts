import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sanitizeString, sanitizePayload } from "../redaction";

describe("Telemetry Minimization & Secret Redaction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Secret Patterns Detection", () => {
    it("redacts OpenAI API keys", () => {
      const text = "Using key sk-abcdef1234567890abcdef1234567890 in client";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Using key [REDACTED_OPENAI_KEY] in client");
      expect(sanitized).not.toContain("sk-abcdef");
    });

    it("redacts Anthropic API keys", () => {
      const text = "ANTHROPIC_KEY=sk-ant-api03-abcdef1234567890abcdef12345";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("ANTHROPIC_KEY=[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized).not.toContain("sk-ant-");
    });

    it("redacts GitHub personal access tokens", () => {
      const text1 = "ghp_1234567890abcdef1234567890abcdef1234";
      const text2 = "github_pat_11AAAAAAA01234567890abcdef1234567890abcdef1234567890";
      expect(sanitizeString(text1).sanitized).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(sanitizeString(text2).sanitized).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("redacts AWS Access Key IDs", () => {
      const text = "Connect with AKIAIOSFODNN7EXAMPLE to S3";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Connect with [REDACTED_AWS_KEY] to S3");
    });

    it("redacts Bearer tokens in headers or strings", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Authorization: Bearer [REDACTED_BEARER_TOKEN]");
    });

    it("redacts PEM private key blocks", () => {
      const pem =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y...\n-----END RSA PRIVATE KEY-----";
      const { sanitized, redacted } = sanitizeString(pem);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("[REDACTED_PRIVATE_KEY]");
    });

    it("redacts credentials in database URLs", () => {
      const url = "postgres://admin:super_secret_pw@db.production.internal:5432/main";
      const { sanitized, redacted } = sanitizeString(url);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("postgres://admin:[REDACTED_CREDENTIALS]@db.production.internal:5432/main");
      expect(sanitized).not.toContain("super_secret_pw");
    });

    it("redacts secret query parameters in URLs", () => {
      const url = "https://api.provider.com/v1/data?api_key=my_secret_token_123&format=json";
      const { sanitized, redacted } = sanitizeString(url);
      expect(redacted).toBe(true);
      expect(sanitized).toContain("api_key=[REDACTED_QUERY_PARAM]");
      expect(sanitized).not.toContain("my_secret_token_123");
    });

    it("redacts configured environment variable secrets", () => {
      process.env["AGENTPULSE_INGEST_KEY"] = "super-secret-ingest-key-999";
      const text = "Client passed key super-secret-ingest-key-999 to server";
      const { sanitized, redacted } = sanitizeString(text, [], true);
      expect(redacted).toBe(true);
      expect(sanitized).toContain("[REDACTED_ENV_SECRET]");
      expect(sanitized).not.toContain("super-secret-ingest-key-999");
    });
  });

  describe("Object & Payload Sanitization Pipeline", () => {
    it("redacts sensitive object keys recursively", () => {
      const payload = {
        user: "alice",
        password: "PlaintextPassword123!",
        nested: {
          token: "secret-token-xyz",
          apiKey: "sk-abcdef1234567890abcdef1234567890",
          validField: "keep-me",
        },
      };

      const result = sanitizePayload(payload);
      expect(result.redacted).toBe(true);
      expect(result.fields_redacted).toContain("password");
      expect(result.fields_redacted).toContain("token");
      expect(result.fields_redacted).toContain("apiKey");

      const val = result.value as typeof payload;
      expect(val.password).toBe("[REDACTED_SECRET]");
      expect(val.nested.token).toBe("[REDACTED_SECRET]");
      expect(val.nested.apiKey).toBe("[REDACTED_SECRET]");
      expect(val.nested.validField).toBe("keep-me");
    });

    it("redacts sensitive HTTP headers in payloads", () => {
      const payload = {
        headers: {
          "authorization": "Bearer secret-token-header",
          "cookie": "session_id=12345",
          "content-type": "application/json",
          "x-api-key": "some-key",
        },
      };

      const result = sanitizePayload(payload);
      expect(result.redacted).toBe(true);
      const val = result.value as typeof payload;
      expect(val.headers.authorization).toBe("[REDACTED_SECRET]");
      expect(val.headers.cookie).toBe("[REDACTED_SECRET]");
      expect(val.headers["x-api-key"]).toBe("[REDACTED_SECRET]");
      expect(val.headers["content-type"]).toBe("application/json");
    });

    it("supports STRUCTURE_ONLY capture mode (omits payload content while calculating hashes)", () => {
      const payload = {
        prompt: "Classify this sensitive patient record: diagnosis XYZ",
        history: ["turn 1", "turn 2"],
        meta: { count: 2 },
      };

      const result = sanitizePayload(payload, { modeOverride: "STRUCTURE_ONLY" });
      expect(result.redacted).toBe(true);
      expect(result.content_status).toBe("fully_redacted");
      expect(result.original_hash).toBeDefined();
      expect(result.persisted_hash).toBeDefined();

      const structure = result.value as Record<string, unknown>;
      expect(structure["type"]).toBe("object");
      expect(structure).not.toHaveProperty("prompt", "Classify this sensitive patient record: diagnosis XYZ");
    });

    it("FULL_CONTENT mode STILL scrubs mandatory secrets", () => {
      const payload = {
        prompt: "Using OpenAI key sk-abcdef1234567890abcdef1234567890 to query",
        password: "mypassword123",
        safeData: "This is completely safe",
      };

      const result = sanitizePayload(payload, { modeOverride: "FULL_CONTENT" });
      expect(result.redacted).toBe(true);

      const val = result.value as typeof payload;
      expect(val.safeData).toBe("This is completely safe");
      // Mandatory secret redaction must still happen!
      expect(val.prompt).toBe("Using OpenAI key [REDACTED_OPENAI_KEY] to query");
      expect(val.password).toBe("[REDACTED_SECRET]");
    });
  });
});
