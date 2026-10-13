import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTPULSE_TABLES } from "@/lib/db/storageHealth";
import { _resetDbClient } from "@/lib/db/client";
import { _resetMigrationFlag } from "@/lib/db/migrate";

type MockRow = Record<string, unknown>;
type MockSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<MockRow[]>;
  unsafe(query: string): Promise<MockRow[]>;
  end(options?: { timeout?: number }): Promise<void>;
};

describe("Postgres store migration", () => {
  const savedDatabaseUrl = process.env["DATABASE_URL"];
  let createdTables: Set<string>;
  let executedQueries: string[];

  beforeEach(() => {
    _resetDbClient();
    _resetMigrationFlag();
    createdTables = new Set();
    executedQueries = [];
    process.env["DATABASE_URL"] = "postgresql://localhost/agentpulse_empty_test";

    vi.spyOn(console, "info").mockImplementation(() => {});

    vi.doMock("postgres", () => ({
      default: vi.fn(() => createMockSql(createdTables, executedQueries)),
    }));
  });

  afterEach(() => {
    _resetDbClient();
    _resetMigrationFlag();
    if (savedDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedDatabaseUrl;
    vi.doUnmock("postgres");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runs migrations before listing integrations on an empty database", async () => {
    const { getIntegrationStore } = await import("@/lib/db/getStores");

    await expect(getIntegrationStore().listIntegrations()).resolves.toEqual([]);

    expect([...createdTables].sort()).toEqual([...AGENTPULSE_TABLES].sort());
    expect(executedQueries.some((query) => query.includes("SELECT * FROM ap_integrations"))).toBe(true);
    expect(console.info).toHaveBeenCalledWith("AgentPulse using Postgres store");
    expect(console.info).toHaveBeenCalledWith("Running Postgres migration");
    expect(console.info).toHaveBeenCalledWith("Postgres migration complete");
  });
});

function createMockSql(createdTables: Set<string>, executedQueries: string[]): MockSql {
  const sql = (async (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<MockRow[]> => {
    const query = strings.join("?");
    executedQueries.push(query);

    if (query.includes("SELECT * FROM ap_integrations")) {
      if (!createdTables.has("ap_integrations")) {
        throw new Error('relation "ap_integrations" does not exist');
      }
      return [];
    }

    return [];
  }) as MockSql;

  sql.unsafe = async (query: string): Promise<MockRow[]> => {
    executedQueries.push(query);
    const tableName = query.match(/CREATE TABLE IF NOT EXISTS\s+(ap_[a-z_]+)/i)?.[1];
    if (tableName) {
      createdTables.add(tableName);
    }
    return [];
  };

  sql.end = async () => {};

  return sql;
}
