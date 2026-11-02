import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMapFile } from "@o-tid/map-file";
import { iofCourseFile } from "./course-setting-iof";
import { testDocument } from "./course-setting-test-document";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../fixtures/maps/${name}`, import.meta.url)));

describe("ADR-0190: IOF XML (banor) från banläggningen", () => {
  it("kartans yta och lägen i WGS 84 när kartfilen är georefererad; klasserna ur undertiteln", () => {
    const map = readMapFile(fixture("kartfil.omap"), "kartfil.omap");
    const document = { ...testDocument(), courses: [{ ...testDocument().courses[0]!, secondaryTitle: "H21, D21", climbMeters: 40 }] };
    const file = iofCourseFile(document, { mapBounds: { minX: -5, minY: -5, maxX: 50, maxY: 40 }, georeference: map.georeference,
      now: new Date("2026-11-02T20:00:00Z") });
    expect(file.fileName).toBe("Träning IOF.xml");
    expect(file.xml).toContain('<MapPositionTopLeft x="-5" y="40" />');
    expect(file.xml).toMatch(/<Position lng="1[0-9]\.\d+" lat="5[5-9]\.\d+" \/>/);
    // Inläsningen av samma fil prövas i paketet application (course-setting-transfer.test.ts).
    expect(file.xml).toContain("<Climb>40</Climb>");
    expect(file.xml.match(/<ClassName>(.*)<\/ClassName>/g)).toEqual(["<ClassName>H21</ClassName>", "<ClassName>D21</ClassName>"]);
    expect(file.xml.match(/<Position /g)).toHaveLength(4);
    // Utan georeferens: inga Position, bara kartlägen.
    expect(iofCourseFile(document).xml).not.toContain("<Position");
  });
});
