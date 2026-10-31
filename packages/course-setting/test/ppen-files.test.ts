import { basename, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CourseSettingEditError, readPpen, writePpen } from "../src";
import { normalizedXml, ppenFiles, readText, testFilesDir } from "./helpers";

/** Filer som Purple Pen själv inte kan läsa (okänt kontrollslag "marked-route-end"). */
const UNREADABLE = new Set(["sampleevent2.ppen"]);

const files = ppenFiles();

const withoutCourseOrder = (xml: string) => xml.replace(/(<course id="\d+" kind="\w+") order="\d+"/g, "$1");

describe.skipIf(files.length === 0)("Purple Pens testfiler", () => {
  it("finns alla 152", () => {
    expect(files).toHaveLength(152);
  });

  for (const path of files) {
    const name = relative(testFilesDir, path);
    if (UNREADABLE.has(name)) {
      it(`${name} går inte att läsa, som i Purple Pen`, () => {
        expect(() => readPpen(readText(path))).toThrow(CourseSettingEditError);
      });
      continue;
    }
    it(`${name} går fram och tillbaka`, () => {
      const xml = readText(path);
      const first = readPpen(xml);
      const written = writePpen(first.document);
      // Äldre filer saknar banornas ordning; den läggs till som när Purple Pen sparar.
      const added = first.warnings.some(w => w.code === "COURSE_ORDER_MISSING");
      expect(normalizedXml(added ? withoutCourseOrder(written) : written)).toEqual(normalizedXml(xml));
      expect(readPpen(written).document).toEqual(first.document);
    });
  }

  for (const name of ["XUnreadable.coursescribe", "XBogus.coursescribe"]) {
    it(`${name} ger INVALID`, () => {
      try {
        readPpen(readText(`${testFilesDir}/${name}`));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CourseSettingEditError);
        expect((error as CourseSettingEditError).code).toBe("INVALID");
      }
    });
  }

  it("rapporterar specialobjekten i testfilerna", () => {
    const kinds = new Map<string, number>();
    for (const path of files) {
      if (UNREADABLE.has(basename(path)) && relative(testFilesDir, path) === basename(path)) continue;
      for (const special of readPpen(readText(path)).document.specialObjects) kinds.set(special.kind, (kinds.get(special.kind) ?? 0) + 1);
    }
    expect([...kinds.keys()].sort()).toEqual(expect.arrayContaining(["descriptions", "text"]));
    console.info("Specialobjekt i Purple Pens testfiler:", Object.fromEntries([...kinds].sort()));
  });
});
