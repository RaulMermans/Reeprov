import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTPULSE_TABLES, REEPROV_TABLES } from "@/lib/db/storageHealth";
import { _resetDbClient, _setDbClient } from "@/lib/db/client";
import { _resetMigrationFlag } from "@/lib/db/migrate";
import { _resetLoggedPostgresStore } from "@/lib/db/getStores";

type MockRow = Record<string, unknown>;
type MockSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<MockRow[]>;
  unsafe(query: string): Promise<MockRow[]>;
  end(options?: { timeout?: number }): Promise<void>;
};

let createdTables = new Set<string>();
let executedQueries: string[] = [];

describe("Postgres store migration", () => {
  const savedDatabaseUrl = process.env["DATABASE_URL"];

  beforeEach(() => {
    _resetDbClient();
    _resetMigrationFlag();
    _resetLoggedPostgresStore();
    createdTables.clear();
    executedQueries.length = 0;
    process.env["DATABASE_URL"] = "postgresql://localhost/agentpulse_empty_test";
    _setDbClient(createMockSql(createdTables, executedQueries) as any);

    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    _resetDbClient();
    _resetMigrationFlag();
    _resetLoggedPostgresStore();
    if (savedDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = savedDatabaseUrl;
    vi.restoreAllMocks();
  });

  it("runs migrations before listing integrations on an empty database", async () => {
    const { getIntegrationStore } = await import("@/lib/db/getStores");

    await expect(getIntegrationStore().listIntegrations()).resolves.toEqual([]);

    expect([...createdTables].sort()).toEqual([...REEPROV_TABLES].sort());
    expect(executedQueries.some((query) => query.includes("SELECT * FROM ap_integrations"))).toBe(true);
    expect(console.info).toHaveBeenCalledWith("Reeprov using Postgres store");
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

    if (query.includes("to_regclass")) {
      const match = query.match(/'(?:public\.)?([^']+)'/);
      const tableName = match?.[1]?.replace(/^public\./, "");
      if (tableName && createdTables.has(tableName)) {
        return [{ exists: tableName }];
      }
      return [{ exists: null }];
    }

    if (query.includes("CREATE TABLE IF NOT EXISTS")) {
      const match = query.match(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/i);
      if (match?.[1]) {
        createdTables.add(match[1]);
      }
      return [];
    }

    return [];
  }) as MockSql;

  sql.unsafe = async (query: string): Promise<MockRow[]> => {
    executedQueries.push(query);
    if (query.includes("CREATE TABLE IF NOT EXISTS")) {
      const match = query.match(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/i);
      if (match?.[1]) {
        createdTables.add(match[1]);
      }
    }
    return [];
  };

  sql.end = async (): Promise<void> => {};

  return sql;
}
