import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDocument } from "@o-tid/course-setting";
import { courseSettingFromCourseData, keepEventSettings } from "./course-data-course-setting";

const fixture = readFileSync(new URL("../../../../fixtures/iof/course-file-kartfil.xml", import.meta.url));

describe("banfilen i banläggningen (Använd igen och Banor → Banfil)", () => {
  it("ger dokumentet på kartfilens skala och ett besked om vad som kom med", () => {
    const result = courseSettingFromCourseData(new Uint8Array(fixture), { title: "Kväll", mapScale: 10000 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.document.event.title).toBe("Kväll");
    expect(result.document.courses.map(course => course.name)).toEqual(["Lång"]);
    expect(result.notices[0]).toBe("Banorna kommer från banfilen (1 bana, 9 kontroller). Kontrollbeskrivningarna är tomma.");
    // Filens längd (3 900 m) är inte den uppmätta: sägs en gång, ingen fast längd.
    expect(result.notices[1]).toBe("Banfilens längd för Lång var 3,9 km, uppmätt 2,4 km.");
    expect(result.document.courses[0]!.lengthOverrideMeters).toBeUndefined();
    expect(result.stays).toBe(false);
  });

  it("varianter som blev egna banor: beskedet står kvar tills det stängs", () => {
    const xml = fixture.toString("utf8").replace("<Course>\n      <Name>Lång</Name>",
      "<Course>\n      <Name>Lång A</Name><CourseFamily>Lång</CourseFamily>")
      .replace("</RaceCourseData>", `<Course><Name>Lång B</Name><CourseFamily>Lång</CourseFamily>
        <CourseControl type="Start"><Control>31</Control></CourseControl><CourseControl><Control>32</Control></CourseControl>
        <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course></RaceCourseData>`);
    const result = courseSettingFromCourseData(new TextEncoder().encode(xml), { mapScale: 10000 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stays).toBe(true);
    expect(result.notices).toContain("Lång: varianterna gick inte att göra till gafflingar och är egna banor.");
  });

  it("en fil som inte är en banfil, och kontroller utan läge, ger ett besked", () => {
    const entries = new TextEncoder().encode('<?xml version="1.0"?><EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"/>');
    expect(courseSettingFromCourseData(entries, { mapScale: 10000 })).toEqual({ kind: "problem", text: "Banfilen kunde inte läsas som banor på kartan." });
    const unplaced = new TextEncoder().encode(fixture.toString("utf8").replace(/<MapPosition[^>]*\/>/g, "").replace(/<Position[^>]*\/>/g, ""));
    expect(courseSettingFromCourseData(unplaced, { mapScale: 10000 })).toEqual({ kind: "problem",
      text: "Starten saknar läge på kartan i banfilen. Banorna kan inte läggas på kartan." });
  });

  it("utskriftsprofiler, mallar, ringklipp och träning följer med när banläggningen ersätts", () => {
    const current = { ...emptyDocument({ title: "Gammal", mapScale: 10000 }) };
    const withSettings = { ...current, event: { ...current.event, printProfileId: "bl", circleCutting: { overlap: true, details: false } } };
    const next = emptyDocument({ title: "Ny", mapScale: 10000 });
    const kept = keepEventSettings(next, withSettings);
    expect(kept.event.title).toBe("Ny");
    expect(kept.event.printProfileId).toBe("bl");
    expect(kept.event.circleCutting).toEqual({ overlap: true, details: false });
    expect(keepEventSettings(next, undefined)).toBe(next);
  });
});
