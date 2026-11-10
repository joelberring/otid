import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEO_WORKER_VERSION } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";

/**
 * Ägaren 2026-11-11: servern ger inga jobb till en äldre geo-arbetare; talen i arbetaren och i contracts ska vara lika.
 * Arbetaren läses som text (den körs fristående av Node och importeras inte här).
 */
describe("geo-arbetarens version", () => {
  it("är densamma i arbetaren och i servern", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../scripts/geo-worker.ts"), "utf8");
    expect(Number(/export const WORKER_VERSION = (\d+);/.exec(source)?.[1])).toBe(GEO_WORKER_VERSION);
  });
});
