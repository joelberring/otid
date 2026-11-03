import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyEdit, readPpen } from "@o-tid/course-setting";
import type { LegLength } from "./course-setting-route-length";
import { excludedRows, parseLimit, pruningPlan, variantTable } from "./course-setting-variants";

/** ADR-0197: tabellen över varianterna och förslaget i banläggningen (fixturen med tre gafflingar). */
const document = readPpen(readFileSync(fileURLToPath(new URL("../../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url)), "utf8")).document;
const natt = document.courses.find(course => course.name === "Natt")!.id;
const kort = document.courses.find(course => course.name === "Kort")!.id;

describe("varianterna i banläggningen (ADR-0197)", () => {
  it("åtta rader, ACE kortast, sträckorna utan dubbletter; ogafflad bana ingen tabell", () => {
    const table = variantTable(document, natt, new Map())!;
    expect(table.rows.map(row => row.code)).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"]);
    expect(table.rows[0]).toMatchObject({ code: "ACE", differenceMeters: 0, route: undefined, controlCount: 7, excluded: false });
    expect(table.rows.at(-1)!.differenceMeters).toBeGreaterThan(0);
    // S–31, två alternativ per gaffling (två sträckor var) och 34–mål: 2 + 3 · 4 = 14.
    expect(table.legs).toHaveLength(14);
    expect(table.routeComplete).toBe(false);
    expect(variantTable(document, kort, new Map())).toBeUndefined();
  });

  it("längs vägval när alla sträckor är räknade; skillnaden räknas då längs vägval", () => {
    const empty = variantTable(document, natt, new Map())!;
    const results = new Map<string, LegLength>(empty.legs.map(leg => [leg.key, { best: 100, straight: 50 }]));
    const table = variantTable(document, natt, results)!;
    expect(table.routeComplete).toBe(true);
    expect(table.rows.every(row => row.route === 800 && row.differenceMeters === 0)).toBe(true);
    // Längs vägval finns för alla och jämförs.
    expect(pruningPlan(table, { dominated: true }).measures).toEqual(["STRAIGHT", "ROUTE"]);
    results.set(empty.legs[0]!.key, { best: undefined, straight: 50 });
    expect(variantTable(document, natt, results)!.rows[0]!.route).toBe("NO_ROUTE");
  });

  it("förslaget och bortvalen som UPDATE_COURSE", () => {
    const table = variantTable(document, natt, new Map())!;
    const plan = pruningPlan(table, { dominated: true });
    expect(plan.kept).toContain("ACE");
    expect(plan.kept.length).toBeLessThan(8);
    const rows = excludedRows(table, new Set(plan.excluded.map(row => row.code)));
    const next = applyEdit(document, { type: "UPDATE_COURSE", course: natt, changes: { excludedVariants: rows } }).document;
    const after = variantTable(next, natt, new Map())!;
    expect(after.rows.filter(row => row.excluded).map(row => row.code)).toEqual(plan.excluded.map(row => row.code));
    expect(after.label(after.prunable[0]!.controls[0]!)).toBe("start");
  });

  it("taken i fälten", () => {
    expect(parseLimit("", 0)).toBeUndefined();
    expect(parseLimit(" 10 ", 0)).toBe(10);
    expect(parseLimit("0", 1)).toBe("invalid");
    expect(parseLimit("5,5", 0)).toBe("invalid");
  });
});
