/**
 * Ägarens riktiga filer (Stockholm by Night). De finns inte i repot och testerna körs bara när miljövariablerna pekar
 * på dem: `OTID_REAL_PPEN` (.ppen) och `OTID_REAL_IOF_COURSES` (Purple Pens IOF-export av samma banor), och för
 * ringklippen `OTID_REAL_MAP` (kartfilen, .ocd/.omap) med `OTID_REAL_MAP_PPEN` (banor på den kartan).
 */
import { existsSync, readFileSync } from "node:fs";
import { readMapFile } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  applyEdit, bakeDetailGaps, courseSummaries, courseVariants, DETAIL_GAP_LIMITS, detailCircleCenters, detailCircleGaps, layoutOverprint,
  readPpen, writePpen
} from "../src";
import { totalDegrees } from "../src/arcs";
import { iofCourses, normalizedXml } from "./helpers";

const ppenPath = process.env.OTID_REAL_PPEN;
const iofPath = process.env.OTID_REAL_IOF_COURSES;
const hasPpen = ppenPath !== undefined && existsSync(ppenPath);
const hasIof = hasPpen && iofPath !== undefined && existsSync(iofPath);

describe.skipIf(!hasPpen)("ägarens .ppen (OTID_REAL_PPEN)", () => {
  it("läses och går fram och tillbaka orörd", () => {
    const xml = readFileSync(ppenPath!, "utf8");
    const { document } = readPpen(xml);
    const written = writePpen(document);
    expect(normalizedXml(written)).toEqual(normalizedXml(xml));
    expect(readPpen(written).document).toEqual(document);
  });

  it("läser standarderna", () => {
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    expect(document.event.overprintStandard).toBe("ISOM2017");
    expect(document.event.descriptionStandard).toBe("2018");
  });
});

describe.skipIf(!hasIof)("varianterna mot Purple Pens IOF-export (OTID_REAL_IOF_COURSES)", () => {
  it("ger exakt samma varianter och kontrollföljder", () => {
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    const expected = iofCourses(readFileSync(iofPath!, "utf8"));
    const families = [...new Set(expected.map(course => course.family))];
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      const course = document.courses.find(candidate => candidate.name === family);
      expect(course, family).toBeDefined();
      const ours = courseVariants(document, course!.id).map(variant => ({
        name: variant.code === "" ? family : `${family} ${variant.code}`, codes: variant.controlCodes
      }));
      const theirs = expected.filter(c => c.family === family).map(c => ({ name: c.name, codes: c.codes }));
      expect(ours).toEqual(theirs);
    }
  });

  it("ger samma längder som Purple Pen (avrundat till 100 m)", () => {
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    const expected = iofCourses(readFileSync(iofPath!, "utf8"));
    for (const summary of courseSummaries(document)) {
      for (const variant of summary.variants) {
        const name = variant.code === "" ? summary.name : `${summary.name} ${variant.code}`;
        const iof = expected.find(c => c.name === name);
        if (iof) expect(Math.round(variant.lengthMeters / 100) * 100, name).toBe(iof.length);
      }
    }
  });
});

const mapPath = process.env.OTID_REAL_MAP;
const mapPpenPath = process.env.OTID_REAL_MAP_PPEN;
const hasMap = mapPath !== undefined && existsSync(mapPath) && mapPpenPath !== undefined && existsSync(mapPpenPath);

describe.skipIf(!hasMap)("ringklipp på ägarens karta (OTID_REAL_MAP, OTID_REAL_MAP_PPEN)", () => {
  it("klipper ringarna över detaljer inom budgeten, snabbt, och gör klippen fasta", () => {
    const map = readMapFile(new Uint8Array(readFileSync(mapPath!)), mapPath);
    const { document } = readPpen(readFileSync(mapPpenPath!, "utf8"));
    const centers = detailCircleCenters(document);
    detailCircleGaps(map, centers);
    const start = performance.now();
    const gaps = detailCircleGaps(map, centers);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(Object.keys(gaps).length).toBeGreaterThan(0);
    for (const list of Object.values(gaps)) expect(totalDegrees(list)).toBeLessThanOrEqual(360 * DETAIL_GAP_LIMITS.maxFraction + 1e-6);
    const on = applyEdit(document, { type: "SET_EVENT", changes: { circleCutting: { overlap: true, details: true } } }).document;
    for (const course of [...document.courses.map(c => c.id), "ALL_CONTROLS"]) {
      for (const primitive of layoutOverprint(on, { course, detailGaps: gaps })) {
        if (primitive.kind === "circle") expect(totalDegrees(primitive.gaps ?? [])).toBeLessThanOrEqual(180 + 1e-6);
      }
    }
    let baked = document;
    for (const edit of bakeDetailGaps(document, gaps)) baked = applyEdit(baked, edit).document;
    expect(readPpen(writePpen(baked)).document.controls).toEqual(baked.controls);
    // Inställningen skrivs inte till .ppen.
    expect(writePpen(on)).toBe(writePpen(document));
  });
});
