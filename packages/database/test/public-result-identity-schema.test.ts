import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entries } from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0055_task_089_public_result_identity.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK089 public result identity schema", () => {
  it("keeps an opaque generated identity on the race-scoped entry", () => {
    expect(entries.publicResultId.name).toBe("public_result_id");
    expect(entries.publicResultId.notNull).toBe(true);
    expect(migration).toContain("ALTER TABLE entry ADD COLUMN public_result_id uuid");
    expect(migration).toContain("SET public_result_id = gen_random_uuid()");
    expect(migration).toContain("ALTER COLUMN public_result_id SET DEFAULT gen_random_uuid()");
    expect(migration).toContain("ALTER COLUMN public_result_id SET NOT NULL");
  });

  it("enforces uniqueness only with race scope and registers the additive migration", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX entry_race_public_result_uidx ON entry(race_id, public_result_id)");
    expect(journal.entries?.find((entry) => entry.idx === 55)).toMatchObject({
      idx: 55,
      tag: "0055_task_089_public_result_identity"
    });
  });
});
