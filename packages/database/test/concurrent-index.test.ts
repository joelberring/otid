import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitConcurrentIndexes } from "../src/migrator";

/** Översynen 2026-11-02: CREATE INDEX CONCURRENTLY körs utanför migrationsfilens transaktion. */
describe("index som byggs utan lås", () => {
  it("lyfter ut CONCURRENTLY-satserna och lämnar resten till transaktionen", () => {
    const file = readFileSync(new URL("../migrations/0038_resultat_per_avlasning_index.sql", import.meta.url), "utf8");
    const split = splitConcurrentIndexes(`${file}\nALTER TABLE x ADD COLUMN IF NOT EXISTS y text;\n`);
    expect(split.concurrent).toEqual([
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS result_revision_readout_idx ON result_revision (readout_id) WHERE readout_id IS NOT NULL;"]);
    expect(split.rest).not.toContain("CREATE INDEX");
    expect(split.rest).toContain("ALTER TABLE x ADD COLUMN");
  });

  it("kräver IF NOT EXISTS så att en omkörning är ofarlig", () => {
    expect(() => splitConcurrentIndexes("CREATE INDEX CONCURRENTLY a_idx ON a (b);")).toThrow(/IF NOT EXISTS/);
  });
});
