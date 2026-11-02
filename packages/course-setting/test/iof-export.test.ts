import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPpen, writeIofCourseData } from "../src";
import { testFilesDir } from "./helpers";

/**
 * ADR-0190 beslut 5: IOF XML 3.0 CourseData som Purple Pens ExportXmlVersion3. Purple Pens egna förväntade filer
 * (`fixtures/purplepen/exportxml/*_expected_v3.xml`, skrivna med kartans yta nedan) jämförs rad för rad; bara tiden,
 * programmet och stafettlagens varianter (`TeamCourseAssignment`, inte portade) skiljer. `OTID_IOF_EXPORT_OUT` skriver
 * filerna till en katalog (t.ex. för `xmllint --schema` mot IOF:s XSD, som inte finns i repot).
 */
const dir = join(testFilesDir, "exportxml");
const withoutVolatile = (xml: string) => xml.replace(/\r\n/g, "\n").replace(/ createTime="[^"]*" creator="[^"]*"/, "")
  .replace(/\n {4}<TeamCourseAssignment>[\s\S]*?<\/TeamCourseAssignment>/g, "").trim();

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
      expect(withoutVolatile(actual)).toBe(withoutVolatile(expected));
    });
  }
});
