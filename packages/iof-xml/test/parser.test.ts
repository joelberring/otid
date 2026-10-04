import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IofValidationError, parseIofXml } from "../src";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/iof/${name}`, import.meta.url)), "utf8");
}

describe("parseIofXml", () => {
  it("tolkar en individuell StartList och normaliserar tider till UTC", () => {
    expect(parseIofXml(fixture("start-list.xml"))).toEqual({
      kind: "StartList",
      classes: [
        {
          classExternalId: "class-h21",
          starts: [
            { entryExternalId: "entry-ada", startTime: "2026-08-31T08:00:00.000Z" },
            { entryExternalId: "entry-bo", startTime: "2026-08-31T08:03:00.000Z" }
          ]
        }
      ],
      warnings: []
    });
  });

  it("tillåter metadata för exakt ett race utan att använda den som intern identitet", () => {
    const withSingleRace = fixture("start-list.xml").replace(
      "</Event>",
      "<Race><Name>Individuellt</Name></Race></Event>"
    );
    expect(parseIofXml(withSingleRace)).toMatchObject({ kind: "StartList", classes: [{ classExternalId: "class-h21" }] });
  });

  it.each([
    ["TeamStart", `<TeamStart><EntryId>team-1</EntryId></TeamStart>`],
    ["okänt fält i ClassStart", `<Unexpected />`]
  ])("avvisar %s i StartList-subsetet", (_description, extra) => {
    const xml = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event>
      <ClassStart><Class><Id>h21</Id></Class>${extra}
        <PersonStart><EntryId>e1</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start></PersonStart>
      </ClassStart>
    </StartList>`;
    expect(() => parseIofXml(xml)).toThrow(IofValidationError);
  });

  it("kräver Class.Id, EntryId, exakt en Start och tidszon", () => {
    const base = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event><ClassStart><Class><Name>H21</Name></Class>
      <PersonStart><Start><StartTime>2026-08-31T08:00:00</StartTime></Start></PersonStart>
      </ClassStart></StartList>`;
    expect(() => parseIofXml(base)).toThrow(/Class\.Id|EntryId|StartTime/);

    const twoStarts = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event><ClassStart><Class><Id>h21</Id></Class>
      <PersonStart><EntryId>e1</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start><Start><StartTime>2026-08-31T08:01:00Z</StartTime></Start></PersonStart>
      </ClassStart></StartList>`;
    expect(() => parseIofXml(twoStarts)).toThrow(/exakt en gång/);
  });

  it.each([
    ["raceNumber", `<Start raceNumber="2"><StartTime>2026-08-31T08:00:00Z</StartTime></Start>`],
    ["tidszon", `<Start><StartTime>2026-08-31T08:00:00</StartTime></Start>`],
    ["ogiltigt datum", `<Start><StartTime>2026-02-30T08:00:00Z</StartTime></Start>`],
    ["ogiltig offset", `<Start><StartTime>2026-08-31T08:00:00+15:00</StartTime></Start>`]
  ])("avvisar %s", (_description, start) => {
    const xml = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event><ClassStart><Class><Id>h21</Id></Class>
      <PersonStart><EntryId>e1</EntryId>${start}</PersonStart>
      </ClassStart></StartList>`;
    expect(() => parseIofXml(xml)).toThrow(IofValidationError);
  });

  it("avvisar duplicerade klasser och entries", () => {
    const xml = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event>
      <ClassStart><Class><Id>h21</Id></Class><PersonStart><EntryId>e1</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start></PersonStart></ClassStart>
      <ClassStart><Class><Id>h21</Id></Class><PersonStart><EntryId>e1</EntryId><Start><StartTime>2026-08-31T08:01:00Z</StartTime></Start></PersonStart></ClassStart>
    </StartList>`;
    expect(() => parseIofXml(xml)).toThrow(/förekommer flera gånger/);
  });

  it("avvisar tom klass och Event med flera race", () => {
    const emptyClass = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name></Event><ClassStart><Class><Id>h21</Id></Class></ClassStart>
    </StartList>`;
    expect(() => parseIofXml(emptyClass)).toThrow(/PersonStart saknas|individuella starter/);

    const multipleRaces = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Test</Name><Race><Name>Etapp 1</Name></Race><Race><Name>Etapp 2</Name></Race></Event>
      <ClassStart><Class><Id>h21</Id></Class><PersonStart><EntryId>e1</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start></PersonStart></ClassStart>
    </StartList>`;
    expect(() => parseIofXml(multipleRaces)).toThrow(/högst ett Race/);
  });

  it("begränsar antalet klasser och individuella starter", () => {
    const classStarts = Array.from({ length: 501 }, (_, index) =>
      `<ClassStart><Class><Id>class-${index}</Id></Class><PersonStart><EntryId>entry-${index}</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start></PersonStart></ClassStart>`
    ).join("");
    const tooManyClasses = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Test</Name></Event>${classStarts}</StartList>`;
    expect(() => parseIofXml(tooManyClasses)).toThrow(/högst 500/);

    const persons = Array.from({ length: 10_001 }, (_, index) =>
      `<PersonStart><EntryId>entry-${index}</EntryId><Start><StartTime>2026-08-31T08:00:00Z</StartTime></Start></PersonStart>`
    ).join("");
    const tooManyStarts = `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Test</Name></Event><ClassStart><Class><Id>h21</Id></Class>${persons}</ClassStart></StartList>`;
    expect(() => parseIofXml(tooManyStarts)).toThrow(/högst 10 000/);
  });

  it("tolkar en officiellt strukturerad CourseData 3.0", () => {
    expect(parseIofXml(fixture("course-data.xml"))).toMatchObject({
      kind: "CourseData",
      courses: [
        { externalId: "course-short", name: "Korta", controlCodes: [31, 32, 33] },
        { externalId: "course-alternative", name: "Alternativa", controlCodes: [31, 34] }
      ],
      assignments: [
        {
          classExternalId: "class-h21",
          className: "H21",
          courseExternalId: "course-short",
          startRule: "PUNCH"
        },
        {
          classExternalId: "class-d21",
          className: "D21",
          courseExternalId: "course-alternative",
          startRule: "PUNCH"
        }
      ]
    });
  });

  it("tolkar gafflingar: Course med samma CourseFamily blir en bana med varianter", () => {
    const parsed = parseIofXml(fixture("course-data-forked.xml"));
    if (parsed.kind !== "CourseData") throw new Error("Fel dokumenttyp");
    expect(parsed.courses.map((course) => ({ externalId: course.externalId, name: course.name, controlCodes: course.controlCodes,
      variants: course.variants?.map((variant) => variant.code) }))).toEqual([
      { externalId: "5", name: "Kort", controlCodes: [31, 35, 36, 33], variants: undefined },
      { externalId: "family:Lång", name: "Lång", controlCodes: [], variants: ["AC", "AD", "BC", "BD"] }
    ]);
    expect(parsed.courses[1]!.variants![1]!.controlCodes).toEqual([31, 50, 41, 42, 50, 43, 44, 50, 32, 60, 63, 64, 60, 61, 62, 60, 33]);
    expect(parsed.assignments).toEqual([
      { classExternalId: "gaffel-h21", className: "H21", courseExternalId: "family:Lång", startRule: "PUNCH" },
      { classExternalId: "gaffel-d21", className: "D21", courseExternalId: "5", startRule: "PUNCH" }
    ]);
    expect(parsed.personAssignments).toEqual([]);
  });

  it("tolkar PersonCourseAssignment till löparens variant, även utan Course i filen", () => {
    const parsed = parseIofXml(fixture("course-assignment-forked.xml"));
    expect(parsed).toMatchObject({ kind: "CourseData", courses: [], assignments: [], personAssignments: [
      { entryExternalId: "gaffel-cia", personName: "Cia Holm", className: "H21", courseExternalId: "family:Lång", variantCode: "AD" },
      { personName: "Dan Berg", className: "H21", courseExternalId: "family:Lång", variantCode: "BC" },
      { entryExternalId: "gaffel-eva", courseExternalId: "family:Lång", variantCode: "AC" },
      { entryExternalId: "gaffel-fia", courseExternalId: "family:Lång", variantCode: "BD" }
    ] });
    const unknownVariant = fixture("course-data-forked.xml").replace("</RaceCourseData>",
      "<PersonCourseAssignment><EntryId>x</EntryId><CourseName>Kort</CourseName></PersonCourseAssignment></RaceCourseData>");
    expect(() => parseIofXml(unknownVariant)).toThrow(/okänd variant Kort/);
    const duplicate = fixture("course-data-forked.xml").replace("<Name>Lång-AD</Name>", "<Name>Lång-AC</Name>");
    expect(() => parseIofXml(duplicate)).toThrow(/samma kod/);
  });

  it("tolkar en officiellt strukturerad EntryList 3.0 utan påhittad starttid", () => {
    const parsed = parseIofXml(fixture("entry-list.xml"));
    expect(parsed.kind).toBe("EntryList");
    if (parsed.kind !== "EntryList") throw new Error("Förväntade EntryList");
    expect(parsed.entries[0]).toMatchObject({
      externalId: "entry-ada",
      givenName: "Ada",
      familyName: "Löpare",
      organisationName: "Centrum OK",
      classExternalId: "class-h21",
      className: "H21",
      cardNumber: "12345"
    });
    expect(parsed.entries[0]).not.toHaveProperty("fixedStartTime");
  });

  it("avvisar den gamla icke-standardiserade CourseData-dialekten", () => {
    const oldDialect = `<?xml version="1.0"?>
      <CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>Test</Name></Event>
        <RaceCourseData>
          <Control><Id>31</Id></Control>
          <Course><Id>c1</Id><Name>Korta</Name><CourseControl><Control>31</Control></CourseControl></Course>
          <ClassCourseAssignment startRule="FIXED"><ClassId>h21</ClassId><ClassName>H21</ClassName><CourseId>c1</CourseId></ClassCourseAssignment>
        </RaceCourseData>
      </CourseData>`;
    expect(() => parseIofXml(oldDialect)).toThrow(/CourseName/);
  });

  it("avvisar den gamla icke-standardiserade EntryList-dialekten", () => {
    const oldDialect = `<?xml version="1.0"?>
      <EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>Test</Name></Event>
        <PersonEntry>
          <EntryId>e1</EntryId><Person><Name><Family>Löpare</Family><Given>Ada</Given></Name></Person>
          <EntryClass><Class><Id>h21</Id><Name>H21</Name></Class></EntryClass>
          <StartTime><Time>2026-08-30T10:00:00Z</Time></StartTime>
        </PersonEntry>
      </EntryList>`;
    expect(() => parseIofXml(oldDialect)).toThrow(/PersonEntry\[0\]\.Id/);
  });

  it("avvisar dokument utan IOF:s namnrymd", () => {
    const withoutNamespace = fixture("entry-list.xml").replace(
      ' xmlns="http://www.orienteering.org/datastandard/3.0"',
      ""
    );
    expect(() => parseIofXml(withoutNamespace)).toThrow(/namnrymden/);
  });

  it("avvisar syntaktiskt ogiltig XML", () => {
    expect(() => parseIofXml("<CourseData>")).toThrow(IofValidationError);
  });

  it.each([
    ["DOCTYPE", `<?xml version="1.0"?>
      <!DOCTYPE EntryList [<!ENTITY organiser "hemlig">]>
      <EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>&organiser;</Name></Event>
        <PersonEntry />
      </EntryList>`],
    ["ENTITY", `<?xml version="1.0"?>
      <!ENTITY organiser "hemlig">
      <EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>Test</Name></Event>
      </EntryList>`],
    ["DTD", `<?xml version="1.0"?>
      <!DTD EntryList>
      <EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>Test</Name></Event>
      </EntryList>`],
    ["gemener och blanksteg", `<?xml version="1.0"?>
      <! doctype EntryList>
      <EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
        <Event><Name>Test</Name></Event>
      </EntryList>`]
  ])("avvisar %s före XML-tolkning", (_description, xml) => {
    expect(() => parseIofXml(xml)).toThrowError(
      new IofValidationError(["DTD, DOCTYPE och ENTITY-deklarationer stöds inte"])
    );
  });

  it("avvisar annan IOF-version", () => {
    expect(() => parseIofXml(fixture("course-data.xml").replace('iofVersion="3.0"', 'iofVersion="2.0"')))
      .toThrow(/stöds inte/);
  });
});
