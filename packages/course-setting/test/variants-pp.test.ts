/** Varianterna mot Purple Pens egna tester och förväntade IOF-exporter (Purple Pens testfiler, BSD). */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courseVariants, readPpen } from "../src";
import { variantLetters } from "../src/walk";
import { iofCourses, readText, testFilesDir } from "./helpers";

const has = existsSync(testFilesDir);
const read = (name: string) => readPpen(readText(`${testFilesDir}/${name}`)).document;

describe.skipIf(!has)("varianter som Purple Pen", () => {
  it("queryevent/variations.ppen ger QueryEventTests.GetAllVariations", () => {
    const codes = courseVariants(read("queryevent/variations.ppen"), "1").map(v => v.code);
    expect([...codes].sort()).toEqual([
      "ACDEFH", "ACDEFI", "ACDEFJ", "ACDEGH", "ACDEGI", "ACDEGJ", "ACEFDH", "ACEFDI", "ACEFDJ", "ACEGDH", "ACEGDI", "ACEGDJ",
      "ADCEFH", "ADCEFI", "ADCEFJ", "ADCEGH", "ADCEGI", "ADCEGJ", "ADEFCH", "ADEFCI", "ADEFCJ", "ADEGCH", "ADEGCI", "ADEGCJ",
      "AEFCDH", "AEFCDI", "AEFCDJ", "AEFDCH", "AEFDCI", "AEFDCJ", "AEGCDH", "AEGCDI", "AEGCDJ", "AEGDCH", "AEGDCI", "AEGDCJ", "B"
    ]);
    expect(codes).toEqual([...codes].sort());
  });

  it("queryevent/variations.ppen ger QueryEventTests.GetVariationString", () => {
    const letters = variantLetters(read("queryevent/variations.ppen"), "1");
    expect(["2", "27", "30", "26", "25", "4", "28"].map(id => letters.get(id) ?? "").join("")).toBe("AEFDCI");
  });

  for (const name of ["relay", "mapexchange1", "marymoor"]) {
    it(`exportxml/${name}.ppen ger samma banor som ${name}_expected_v3.xml`, () => {
      const document = read(`exportxml/${name}.ppen`);
      const expected = iofCourses(readText(`${testFilesDir}/exportxml/${name}_expected_v3.xml`));
      let compared = 0;
      for (const course of document.courses) {
        const theirs = expected.filter(c => c.family === course.name);
        if (theirs.length === 0) continue;
        const ours = courseVariants(document, course.id).map(v => ({ name: v.code === "" ? course.name : `${course.name} ${v.code}`, codes: v.controlCodes, length: Math.round(v.lengthMeters / 100) * 100 }));
        expect(ours.map(o => o.name), course.name).toEqual(theirs.map(t => t.name));
        // Poängbanor exporteras i kodordning.
        const order = (codes: readonly string[]) => course.kind === "SCORE" ? [...codes].sort() : codes;
        expect(ours.map(o => order(o.codes)), course.name).toEqual(theirs.map(t => order(t.codes)));
        compared += ours.length;
      }
      expect(compared).toBeGreaterThan(0);
    });
  }
});
