import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCourseLayout } from "@o-tid/iof-xml";
import { mapPointToWgs84, readMapFile } from "@o-tid/map-file";
import {
  applyEdit, courseDataDocument, courseSummaries, courseVariants, emptyDocument, readPpen, writeIofCourseData, type CourseSettingDocument
} from "../src";
import { testFilesDir } from "./helpers";

/**
 * En banfil utan .ppen som banläggningsdokument. Purple Pens egna exporter (`exportxml/*_expected_v3.xml`) läses in och
 * jämförs med samma .ppen läst direkt: samma kontroller på samma ställe, samma banor i samma ordning, samma varianter.
 */
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const exportDir = join(testFilesDir, "exportxml");
const fromXml = (xml: string, options: Parameters<typeof courseDataDocument>[1] = {}) => courseDataDocument(readCourseLayout(xml), options);

/** Banans varianter som kontrollernas slag, kod och läge (två decimaler), och kartbytet som start (som i IOF XML). */
function routes(document: CourseSettingDocument, courseId: string) {
  return courseVariants(document, courseId).map(variant => ({
    code: variant.code,
    controls: variant.courseControls.map(id => {
      const control = document.controls[document.courseControls[id]!.control]!;
      return `${control.kind === "MAP_EXCHANGE" ? "START" : control.kind}:${control.code ?? ""}@${control.at.x.toFixed(2)},${control.at.y.toFixed(2)}`;
    })
  }));
}

/** Banorna som IOF XML har dem: med start och mål, i ordning; poängbanans kontroller som mängd med poäng. */
function exported(document: CourseSettingDocument) {
  return [...document.courses].sort((a, b) => a.order - b.order).flatMap(course => {
    const all = routes(document, course.id);
    if (!all[0]!.controls.some(item => item.startsWith("START")) || !all[0]!.controls.some(item => item.startsWith("FINISH"))) return [];
    const points = course.kind === "SCORE" ? Object.values(document.courseControls).filter(item => item.points)
      .map(item => `${document.controls[item.control]!.code}=${item.points}`).sort() : [];
    return [{ name: course.name, kind: course.kind, routes: all.map(route => course.kind === "SCORE" ? [...route.controls].sort() : route.controls),
      codes: all.map(route => route.code), points }];
  });
}

describe("banfil (IOF XML CourseData) till banläggning", () => {
  it("Purple Pens export av marymoor: kontroller, passager, poängbana och ordning som i .ppen", () => {
    const ppen = readPpen(readFileSync(join(exportDir, "marymoor.ppen"), "utf8")).document;
    const { document, notices } = fromXml(readFileSync(join(exportDir, "marymoor_expected_v3.xml"), "utf8"), { mapScale: ppen.event.mapScale });
    expect(notices).toEqual([]);
    expect(exported(document)).toEqual(exported(ppen));
    expect(document.courses.find(course => course.kind === "SCORE")).toBeDefined();
    expect(Object.values(document.controls).filter(control => control.kind === "CROSSING_POINT")).toHaveLength(3);
    // Inga beskrivningar i filen: vanliga kontroller tomma, målet och passagerna riktningsraden.
    const normal = Object.values(document.controls).filter(control => control.kind === "NORMAL");
    expect(normal.every(control => control.descriptions.length === 0)).toBe(true);
    // Purple Pens mål är snitslat (14.1), som filens specialInstruction säger.
    const finish = (doc: CourseSettingDocument) => Object.values(doc.controls).find(control => control.kind === "FINISH")!.descriptions.find(box => box.box === "all");
    expect(finish(document)).toEqual({ box: "all", ref: "14.1" });
    expect(finish(document)).toEqual(finish(ppen));
  });

  it("kartbytet blir kartbyte", () => {
    const ppen = readPpen(readFileSync(join(exportDir, "mapexchange1.ppen"), "utf8")).document;
    const { document } = fromXml(readFileSync(join(exportDir, "mapexchange1_expected_v3.xml"), "utf8"), { mapScale: ppen.event.mapScale });
    expect(Object.values(document.controls).filter(control => control.kind === "MAP_EXCHANGE")).toHaveLength(1);
    // Purple Pens kartbyte vid en vanlig kontroll står inte i IOF XML; resten av banorna är desamma.
    const names = exported(ppen).map(course => course.name);
    expect(exported(document).map(course => course.name)).toEqual(names);
  });

  it("Purple Pens stafett med gafflingar: samma gafflade banor och samma variantkoder", () => {
    const ppen = readPpen(readFileSync(join(exportDir, "relay.ppen"), "utf8")).document;
    const { document, notices } = fromXml(readFileSync(join(exportDir, "relay_expected_v3.xml"), "utf8"), { mapScale: ppen.event.mapScale });
    expect(notices).toEqual([]);
    const forked = exported(document).filter(course => course.codes.length > 1);
    expect(forked.length).toBeGreaterThan(0);
    expect(exported(document)).toEqual(exported(ppen));
  });

  it("tur och retur: en syntetisk bana med två gafflingar, poängbana och klasser blir samma dokument", () => {
    let document = emptyDocument({ title: "Syntetisk", mapScale: 10000 });
    const add = (kind: "START" | "NORMAL" | "FINISH" | "CROSSING_POINT", x: number, y: number, code?: string) => {
      const result = applyEdit(document, { type: "ADD_CONTROL", kind, at: { x, y }, ...(code ? { code } : {}) });
      document = result.document;
      return result.created!;
    };
    const start = add("START", 0, 0), finish = add("FINISH", 100, 0);
    const [c31, c32, c33, c34, c35, c36] = [["31", 10, 10], ["32", 20, 30], ["33", 30, -10], ["34", 50, 10], ["35", 60, 30], ["36", 70, -20]]
      .map(([code, x, y]) => add("NORMAL", x as number, y as number, code as string));
    const crossing = add("CROSSING_POINT", 80, 5);
    const edit = (value: Parameters<typeof applyEdit>[1]) => { const result = applyEdit(document, value); document = result.document; return result.created!; };
    // Lång: S–31–{32|33}–34–{35|36}–passagen–M, som i Purple Pen: först den raka banan, sedan gafflingarna.
    const long = edit({ type: "ADD_COURSE", name: "Lång" });
    const at31 = edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c31! });
    const at34 = edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c34!, after: at31 });
    edit({ type: "INSERT_COURSE_CONTROL", course: long, control: crossing, after: at34 });
    edit({ type: "ADD_SPLIT", course: long, at: at31, kind: "FORK", branches: 2 });
    const first = document.courseControls[at31]!.split!.branches;
    edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c32!, after: first[0]! });
    edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c33!, after: first[1]! });
    edit({ type: "ADD_SPLIT", course: long, at: at34, kind: "FORK", branches: 2 });
    const second = document.courseControls[at34]!.split!.branches;
    edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c35!, after: second[0]! });
    edit({ type: "INSERT_COURSE_CONTROL", course: long, control: c36!, after: second[1]! });
    edit({ type: "UPDATE_COURSE", course: long, changes: { secondaryTitle: "H21, D21", climbMeters: 45 } });
    const score = edit({ type: "ADD_COURSE", name: "Poäng", kind: "SCORE" });
    for (const control of [c31!, c34!, c36!]) {
      const created = edit({ type: "INSERT_COURSE_CONTROL", course: score, control });
      edit({ type: "SET_POINTS", course: score, courseControl: created, points: Number(document.controls[control]!.code) - 30 });
    }
    edit({ type: "UPDATE_COURSE", course: score, changes: { secondaryTitle: "Öppen" } });
    expect(courseVariants(document, long)[0]!.courseControls.map(id => document.courseControls[id]!.control)).toEqual([start, c31, c32, c34, c35, crossing, finish]);

    const variants = courseVariants(document, long);
    expect(variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    const back = fromXml(writeIofCourseData(document), { mapScale: 10000 });
    expect(back.notices).toEqual([]);
    expect(exported(back.document)).toEqual(exported(document));
    const longBack = back.document.courses.find(course => course.name === "Lång")!;
    expect(longBack.secondaryTitle).toBe("H21, D21");
    expect(longBack.climbMeters).toBe(45);
    expect(longBack.lengthOverrideMeters).toBeUndefined();
    expect(back.document.courses.find(course => course.name === "Poäng")!.secondaryTitle).toBe("Öppen");

    // ADR-0198: bortvalda varianter skrivs inte i IOF XML; tillbaka blir det samma gafflingar med samma bortval.
    const fewer: CourseSettingDocument = { ...document, courses: document.courses.map(course => course.id === long
      ? { ...course, excludedVariants: [{ code: "AD", controls: ["31", "32", "34", "36"] }, { code: "BC", controls: ["31", "33", "34", "35"] }] } : course) };
    expect(courseVariants(fewer, long).map(variant => variant.code)).toEqual(["AC", "BD"]);
    const again = fromXml(writeIofCourseData(fewer), { mapScale: 10000 });
    expect(again.notices).toEqual([]);
    expect(exported(again.document)).toEqual(exported(fewer));
    const longAgain = again.document.courses.find(course => course.name === "Lång")!;
    expect(longAgain.excludedVariants).toEqual(fewer.courses.find(course => course.id === long)!.excludedVariants);
  });

  it("den syntetiska banfilen och .ppen till samma karta ger samma bana, och lägena stämmer med kartfilens georeferens", () => {
    const ppen = readPpen(readFileSync(join(fixtures, "course-setting/kartfil.ppen"), "utf8")).document;
    const xml = readFileSync(join(fixtures, "iof/course-file-kartfil.xml"), "utf8");
    const { document } = fromXml(xml, { mapScale: 10000 });
    const lang = (doc: CourseSettingDocument) => exported(doc).find(course => course.name === "Lång");
    expect(lang(document)).toEqual(lang(ppen));
    expect(document.courses.find(course => course.name === "Lång")!.secondaryTitle).toBe("H21");
    // Filens Position (WGS 84) är räknad ur kartfilens georeferens: dokumentets mm ger samma läge (kartans skala och nollpunkt).
    const positions = [...xml.matchAll(/<Id>([^<]+)<\/Id>\s*<Position lng="([\d.]+)" lat="([\d.]+)"/g)].map(match => ({ id: match[1]!, lng: Number(match[2]), lat: Number(match[3]) }));
    for (const file of ["kartfil.omap", "kartfil.ocd"]) {
      const map = readMapFile(new Uint8Array(readFileSync(join(fixtures, "maps", file))), file);
      expect(map.scale).toBe(document.event.mapScale);
      for (const position of positions) {
        const control = Object.values(document.controls).find(item => item.code === position.id)
          ?? Object.values(document.controls).find(item => item.kind === (position.id.startsWith("S") ? "START" : "FINISH"))!;
        const geo = mapPointToWgs84(map.georeference!, control.at);
        const meters = Math.hypot((geo.latitude - position.lat) * 111_320, (geo.longitude - position.lng) * 111_320 * Math.cos(position.lat * Math.PI / 180));
        expect(meters, `${file} ${position.id}`).toBeLessThan(1);
      }
    }
  });

  it("varianter som inte går att skriva som gafflingar (olika starter) blir egna banor med ett besked", () => {
    const xml = courseDataXml(`
      ${course("Lång AC", "Lång", ["31", "32", "34", "35"])}
      ${course("Lång BD", "Lång", ["31", "33", "34", "36"]).replace("<Control>S1</Control>", "<Control>S2</Control>")}`,
    ["<ClassCourseAssignment><ClassName>H21</ClassName><CourseFamily>Lång</CourseFamily></ClassCourseAssignment>"]);
    const { document, notices } = fromXml(xml, { mapScale: 10000 });
    expect(document.courses.map(item => item.name)).toEqual(["Lång AC", "Lång BD"]);
    expect(document.courses.every(item => item.secondaryTitle === "H21")).toBe(true);
    expect(notices.map(notice => notice.code)).toEqual(["FORKS_AS_COURSES"]);
    expect(notices[0]!.text).toBe("Lång: varianterna gick inte att göra till gafflingar och är egna banor.");
  });

  it("två varianter med olika vägar mellan samma start och mål blir en gaffling (längre grenar)", () => {
    const xml = courseDataXml(`
      ${course("Lång AC", "Lång", ["31", "32", "34", "35"])}
      ${course("Lång BD", "Lång", ["31", "33", "34", "36"])}`);
    const { document, notices } = fromXml(xml, { mapScale: 10000 });
    expect(notices).toEqual([]);
    expect(courseVariants(document, document.courses[0]!.id).map(variant => variant.controlCodes.join("-"))).toEqual(["31-32-34-35", "31-33-34-36"]);
  });

  it("varianter som är alla kombinationer blir en gafflad bana; filens längd blir fast längd bara när den inte stämmer", () => {
    const xml = courseDataXml(`
      ${course("Lång A", "Lång", ["31", "32", "34"], 9000)}
      ${course("Lång B", "Lång", ["31", "33", "34"], 9000)}
      ${course("Kort", undefined, ["31", "34"], 1100)}`);
    const { document, notices } = fromXml(xml, { mapScale: 10000 });
    expect(notices).toEqual([]);
    const lang = document.courses.find(item => item.name === "Lång")!;
    expect(courseVariants(document, lang.id).map(variant => variant.code)).toEqual(["A", "B"]);
    expect(lang.lengthOverrideMeters).toBe(9000);
    const kort = document.courses.find(item => item.name === "Kort")!;
    expect(courseSummaries(document).find(summary => summary.course === kort.id)!.lengthMeters).toBeCloseTo(1051, 0);
    expect(kort.lengthOverrideMeters).toBeUndefined();
    expect(document.courses.map(item => item.order)).toEqual([1, 2]);
  });

  it("utan MapPosition: läget ur Position med kartans georeferens, annars ett fel som säger vilken kontroll", () => {
    const xml = courseDataXml(course("Kort", undefined, ["31", "34"])).replace(/<MapPosition[^>]*\/>/g, "")
      .replace(/<Id>(\w+)<\/Id>/g, '<Id>$1</Id><Position lat="59.3" lng="18.0" />');
    expect(() => fromXml(xml, { mapScale: 10000 })).toThrow("Starten saknar läge på kartan i banfilen");
    const { document } = fromXml(xml, { mapScale: 10000, fromWgs84: () => ({ x: 5, y: 6 }) });
    expect(Object.values(document.controls).every(control => control.at.x === 5 && control.at.y === 6)).toBe(true);
  });

  it("IOF XML 2.0.3: varianterna blir gafflingar, klasserna och skalan följer med", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CourseData>
  <IOFVersion version="2.0.3" />
  <Map><Scale>15000</Scale></Map>
  <StartPoint><StartPointCode>STA1</StartPointCode><MapPosition x="0" y="0" /></StartPoint>
  ${["31:10:10", "32:20:30", "33:30:-10", "34:50:10"].map(row => { const [code, x, y] = row.split(":"); return `<Control><ControlCode>${code}</ControlCode><MapPosition x="${x}" y="${y}" /></Control>`; }).join("\n  ")}
  <FinishPoint><FinishPointCode>FIN1</FinishPointCode><MapPosition x="60" y="0" /></FinishPoint>
  <Course>
    <CourseName>Gul</CourseName><ClassShortName>D12</ClassShortName>
    <CourseVariation><CourseVariationId>1</CourseVariationId><Name>A</Name><CourseLength>1200</CourseLength>
      <CourseControl><Sequence>1</Sequence><ControlCode>31</ControlCode></CourseControl>
      <CourseControl><Sequence>2</Sequence><ControlCode>32</ControlCode></CourseControl>
      <CourseControl><Sequence>3</Sequence><ControlCode>34</ControlCode></CourseControl></CourseVariation>
    <CourseVariation><CourseVariationId>2</CourseVariationId><Name>B</Name><CourseLength>1200</CourseLength>
      <CourseControl><Sequence>1</Sequence><ControlCode>31</ControlCode></CourseControl>
      <CourseControl><Sequence>2</Sequence><ControlCode>33</ControlCode></CourseControl>
      <CourseControl><Sequence>3</Sequence><ControlCode>34</ControlCode></CourseControl></CourseVariation>
  </Course>
</CourseData>`;
    const { document, notices } = fromXml(xml, { mapScale: 10000 });
    expect(notices.map(notice => notice.code)).toEqual(["SCALE_DIFFERS"]);
    expect(document.event.mapScale).toBe(10000);
    expect(document.courses).toHaveLength(1);
    expect(document.courses[0]!.secondaryTitle).toBe("D12");
    expect(courseVariants(document, document.courses[0]!.id).map(variant => variant.controlCodes.join("-"))).toEqual(["31-32-34", "31-33-34"]);
  });
});

/** En syntetisk IOF XML 3.0 med start, kontrollerna 31–36 och mål. */
function courseDataXml(courses: string, extra: readonly string[] = []): string {
  const controls = [["S1", "Start", 0, 0], ["S2", "Start", 5, -5], ["31", "Control", 10, 10], ["32", "Control", 20, 30], ["33", "Control", 30, -10], ["34", "Control", 50, 10],
    ["35", "Control", 60, 30], ["36", "Control", 70, -20], ["F1", "Finish", 100, 0]] as const;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
  <Event><Name>Syntetisk</Name></Event>
  <RaceCourseData>
    <Map><Scale>10000</Scale></Map>
    ${controls.map(([id, type, x, y]) => `<Control type="${type}"><Id>${id}</Id><MapPosition x="${x}" y="${y}" /></Control>`).join("\n    ")}
    ${courses}
    ${extra.join("\n    ")}
  </RaceCourseData>
</CourseData>`;
}

function course(name: string, family: string | undefined, codes: readonly string[], length?: number): string {
  return `<Course><Name>${name}</Name>${family ? `<CourseFamily>${family}</CourseFamily>` : ""}${length ? `<Length>${length}</Length>` : ""}
      <CourseControl type="Start"><Control>S1</Control></CourseControl>
      ${codes.map(code => `<CourseControl><Control>${code}</Control></CourseControl>`).join("")}
      <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>`;
}
