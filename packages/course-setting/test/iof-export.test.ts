import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPpen, writeIofCourseData } from "../src";
import { testFilesDir } from "./helpers";

/**
 * ADR-0190 beslut 5: IOF XML 3.0 CourseData som Purple Pens ExportXmlVersion3. Purple Pens egna förväntade filer
 * (`fixtures/purplepen/exportxml/*_expected_v3.xml`, skrivna med kartans yta nedan) jämförs rad för rad; bara tiden,
 * programmet, stafettlagens varianter (`TeamCourseAssignment`, inte portade) och poängbanor utan satta poäng skiljer: O-Tid
 * skriver förvalet ur koden (`scorePoints`), som banläggningen visar och tävlingen räknar, där Purple Pen inte skriver `Score`. `OTID_IOF_EXPORT_OUT` skriver
 * filerna till en katalog (t.ex. för `xmllint --schema` mot IOF:s XSD, som inte finns i repot).
 */
const dir = join(testFilesDir, "exportxml");
const withoutVolatile = (xml: string) => xml.replace(/\r\n/g, "\n").replace(/ createTime="[^"]*" creator="[^"]*"/, "")
  .replace(/\n {4}<TeamCourseAssignment>[\s\S]*?<\/TeamCourseAssignment>/g, "").trim();

/** Purple Pens fil har ingen `Score` på poängbanan utan satta poäng ("ScoreNoPoints"); O-Tid skriver förvalet (se ovan). */
const scoreNoPoints = /<Course>\s*<Name>ScoreNoPoints<\/Name>[\s\S]*?<\/Course>/;
const withoutDefaultScores = (xml: string) => xml.replace(scoreNoPoints, course => course.replace(/\n\s*<Score>\d+<\/Score>/g, ""));

const CASES = [
  { name: "marymoor", bounds: { minX: -29.5, minY: -113.1, maxX: 232.9, maxY: 86.7 } },
  { name: "mapexchange1", bounds: { minX: -29.5, minY: -113.1, maxX: 232.9, maxY: 86.7 } },
  { name: "relay", bounds: { minX: -22, minY: -270, maxX: 257, maxY: -54 } }
] as const;

describe("IOF XML 3.0 CourseData som Purple Pen", () => {
  for (const { name, bounds } of CASES) {
    it(`${name}: samma fil som Purple Pens export`, () => {
      const document = readPpen(readFileSync(join(dir, `${name}.ppen`), "utf8")).document;
      const actual = writeIofCourseData(document, { mapBounds: bounds, createTime: new Date("2026-11-02T20:00:00Z") });
      const out = process.env.OTID_IOF_EXPORT_OUT;
      if (out) writeFileSync(join(out, `${name}.xml`), actual);
      const expected = readFileSync(join(dir, `${name}_expected_v3.xml`), "utf8");
      expect(withoutVolatile(withoutDefaultScores(actual))).toBe(withoutVolatile(expected));
    });
  }

  it("poängbana utan satta poäng: förvalet ur koden (koden delat med tio) skrivs som Score", () => {
    const document = readPpen(readFileSync(join(dir, "marymoor.ppen"), "utf8")).document;
    const actual = writeIofCourseData(document, { mapBounds: CASES[0].bounds, createTime: new Date("2026-11-02T20:00:00Z") });
    const course = scoreNoPoints.exec(actual)?.[0] ?? "";
    const controls = [...course.matchAll(/<CourseControl type="Control" randomOrder="true">\s*<Control>(\d+)<\/Control>\s*<Score>(\d+)<\/Score>/g)];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.length).toBe([...course.matchAll(/type="Control"/g)].length);
    for (const [, code, score] of controls) expect(Number(score)).toBe(Math.floor(Number(code) / 10));
  });
});
