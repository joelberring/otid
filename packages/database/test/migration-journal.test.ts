import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMigrationJournal } from "../src/migrator";

/** Steg 44: migratorn bokför per tagg, så journalen måste ha unika taggar (och unika `when` för databaser från före steg 44). */
const folder = fileURLToPath(new URL("../migrations", import.meta.url));
const entries = readMigrationJournal(folder);

describe("steg 44: migrationsjournalen", () => {
  it("har unika taggar och unika `when`, och varje tagg har en fil", () => {
    expect(new Set(entries.map((entry) => entry.tag)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.when)).size).toBe(entries.length);
    for (const entry of entries) expect(existsSync(`${folder}/${entry.tag}.sql`), entry.tag).toBe(true);
  });

  it("numrerar journalens idx 0..n i ordning", () => {
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });
});
