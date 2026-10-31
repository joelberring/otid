/**
 * Ägarens riktiga filer (Stockholm by Night). De finns inte i repot och testerna körs bara när miljövariablerna pekar
 * på dem: `OTID_REAL_PPEN` (.ppen) och `OTID_REAL_IOF_COURSES` (Purple Pens IOF-export av samma banor).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courseSummaries, courseVariants, readPpen, writePpen } from "../src";
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
