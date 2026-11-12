import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeIofXml, IofValidationError, parseIofXml } from "../src";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/iof/${name}`, import.meta.url)), "utf8");
}

describe("begripliga fel, Person.Id och ISO-8859-1 (översynen 2026-11-02)", () => {
  it("säger vilket element och vilken rad", () => {
    const xml = fixture("start-list.xml").replace("<StartTime>2026-08-31T08:03:00Z</StartTime>", "<StartTime>2026-08-31T08:03:00</StartTime>");
    let issues: readonly string[] = [];
    try { parseIofXml(xml); } catch (error) { issues = (error as IofValidationError).issues; }
    expect(issues).toEqual(["Rad 22: ClassStart[0].PersonStart[1].Start.StartTime måste vara en ISO 8601-tid med Z eller explicit UTC-offset"]);
    const entries = fixture("entry-list.xml").replace(">67890<", ">0678<");
    expect(() => parseIofXml(entries)).toThrow(/Rad 11: PersonEntry\[1\] Bo Skog: ControlCard "0678"/);
    expect(() => parseIofXml("<StartList>\n<Event></StartList>")).toThrow(/Rad 2, kolumn \d+: filen är inte giltig XML/);
  });

  it("matchar på Person.Id när EntryId saknas", () => {
    const xml = fixture("start-list.xml").replace("<EntryId>entry-bo</EntryId>", "<Person><Id>person-bo</Id></Person>");
    expect(parseIofXml(xml)).toMatchObject({ classes: [{ starts: [{ entryExternalId: "entry-ada" },
      { entryExternalId: "", personExternalId: "person-bo" }] }] });
    expect(parseIofXml(fixture("entry-list.xml"))).toMatchObject({ entries: [{ externalId: "entry-ada", personExternalId: "person-ada" },
      { externalId: "entry-bo", personExternalId: "person-bo" }] });
    expect(() => parseIofXml(xml.replace("<Person><Id>person-bo</Id></Person>", ""))).toThrow(/EntryId saknas \(och Person\.Id saknas/);
  });

  it("läser ISO-8859-1 när deklarationen säger det, och avvisar annan kodning begripligt", () => {
    const latin = fixture("entry-list.xml").replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    const bytes = Uint8Array.from([...latin].map((char) => char.charCodeAt(0)));
    const decoded = decodeIofXml(bytes);
    expect("xml" in decoded && parseIofXml(decoded.xml)).toMatchObject({ entries: [{ familyName: "Löpare" }, { familyName: "Skog" }] });
    expect(decodeIofXml(bytes.map((byte) => byte))).toEqual(decoded);
    const notUtf8 = Uint8Array.from([...fixture("entry-list.xml")].map((char) => char.charCodeAt(0)));
    expect(JSON.stringify(decodeIofXml(notUtf8))).toMatch(/"issue":"Filen är inte UTF-8/);
    expect(decodeIofXml(new TextEncoder().encode('<?xml version="1.0" encoding="UTF-16"?><a/>'))).toEqual({
      issue: "Teckenkodningen UTF-16 stöds inte. Spara filen som UTF-8 eller ISO-8859-1." });
  });
});

describe("parseIofXml", () => {
  it("tolkar en individuell StartList och normaliserar tider till UTC", () => {
    expect(parseIofXml(fixture("start-list.xml"))).toEqual({
      kind: "StartList",
      classes: [
        {
          classExternalId: "class-h21",
          className: "H21",
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

  it("tolkar en banfil från OCAD utan Course.Id: banans namn är dess id", () => {
    const parsed = parseIofXml(fixture("course-file-1.xml"));
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    expect(parsed.courses.map(course => [course.externalId, course.controlCodes])).toEqual([
      ["Bana 1", [31, 32, 33, 34]], ["Bana 2", [31, 35, 33]], ["Bana 3", [31, 36, 37]]]);
    expect(parsed.assignments.map(row => [row.className, row.courseExternalId])).toEqual([
      ["H21", "Bana 1"], ["D21", "Bana 2"], ["H35", "Bana 2"], ["D35", "Bana 3"]]);
    // PLAN.md steg 25: banans längd och stigning i hela meter.
    expect(parsed.courses.map(course => [course.name, course.lengthMeters, course.climbMeters])).toEqual([
      ["Bana 1", 2900, 15], ["Bana 2", 2300, 15], ["Bana 3", 2100, 15]]);
  });

  it("ogiltig längd hoppas över med en varning och decimaler avrundas", () => {
    const xml = fixture("course-file-1.xml").replace("<Length>2900</Length>", "<Length>abc</Length>")
      .replace("<Length>2300</Length>", "<Length>2349.6</Length>");
    const parsed = parseIofXml(xml);
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    expect(parsed.courses.map(course => course.lengthMeters)).toEqual([undefined, 2350, 2100]);
    expect(parsed.warnings.some(warning => warning.includes("Length"))).toBe(true);
  });

  it("steg 49: kontrollernas lägen, start och mål, och variantens längd ur lägena när Length saknas", () => {
    const course = fixture("course-file-1.xml");
    const parsed = parseIofXml(course);
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    expect(parsed.controlPositions.find(control => control.code === 31)).toEqual({ code: 31, latitude: 59.4031, longitude: 17.9431 });
    expect(parsed.courses[0]!.startPosition).toEqual({ latitude: 59.4, longitude: 17.94 });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Gafflat</Name></Event><RaceCourseData><Map><Scale>10000</Scale></Map>
      <Control type="Start"><Id>S1</Id><MapPosition x="0" y="0" unit="mm"/></Control>
      <Control><Id>31</Id><MapPosition x="30" y="40" unit="mm"/></Control>
      <Control><Id>32</Id><MapPosition x="0" y="40" unit="mm"/></Control>
      <Control type="Finish"><Id>F1</Id><MapPosition x="0" y="0" unit="mm"/></Control>
      <Course><Name>A-1</Name><CourseFamily>A</CourseFamily><CourseControl type="Start"><Control>S1</Control></CourseControl>
        <CourseControl><Control>31</Control></CourseControl><CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
      <Course><Name>A-2</Name><CourseFamily>A</CourseFamily><CourseControl type="Start"><Control>S1</Control></CourseControl>
        <CourseControl><Control>32</Control></CourseControl><CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
      </RaceCourseData></CourseData>`;
    const forked = parseIofXml(xml);
    if (forked.kind !== "CourseData") throw new Error("Fel typ");
    // Steg 52: kartlägena (mm) för kontrollerna, start och mål och kartans skala sparas för kontrollkartan.
    expect(forked.controlMapPositions).toEqual([{ code: 31, x: 30, y: 40 }, { code: 32, x: 0, y: 40 }]);
    expect(forked.mapScale).toBe(10000);
    expect(forked.courses[0]).toMatchObject({ startMapPosition: { x: 0, y: 0 }, finishMapPosition: { x: 0, y: 0 } });
    expect(parsed.controlMapPositions?.find(control => control.code === 31)).toEqual({ code: 31, x: 93, y: 62 });
    expect(parsed.mapScale).toBe(4000);
    // 1:10 000: 50 mm = 500 m dit och tillbaka; 40 mm = 400 m dit och tillbaka.
    expect(forked.courses[0]!.variants!.map(variant => [variant.code, variant.lengthMeters])).toEqual([["1", 1000], ["2", 800]]);
    expect(forked.courses[0]!.lengthMeters).toBeUndefined();
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
    // Steg 49: varje variants längd ur banfilen.
    expect(parsed.courses[1]!.variants!.map((variant) => variant.lengthMeters)).toEqual([6200, 6200, 6200, 6200]);
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

  it("avvisar ett bricknummer som Eventor inte godtar och pekar ut anmälan (PLAN.md steg 22)", () => {
    const card = '<ControlCard punchingSystem="SPORTident">12345</ControlCard>';
    const withBadCard = fixture("entry-list.xml").replace(card, card.replace("12345", "012345"));
    expect(() => parseIofXml(withBadCard)).toThrow(/PersonEntry\[0\] Ada Löpare: ControlCard "012345"/);
    const withLetters = fixture("entry-list.xml").replace(card, card.replace("12345", "SI-12345"));
    expect(() => parseIofXml(withLetters)).toThrow(IofValidationError);
    const withoutCard = fixture("entry-list.xml").replace(card, "");
    expect(parseIofXml(withoutCard).kind).toBe("EntryList");
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

describe("IOF XML 2.0.3 CourseData (ADR-0196)", () => {
  const v2 = (courses: string, extra = "") => `<?xml version="1.0" encoding="utf-8"?>
<CourseData>
  <IOFVersion version="2.0.3" />
  <Map><Scale>15000</Scale><MapPosition x="-126.79" y="31.37" /></Map>
  <StartPoint><StartPointCode>STA1</StartPointCode><ControlPosition x="666890" y="6573208" /><MapPosition x="59.36" y="-52.77" /></StartPoint>
  <Control><ControlCode>31</ControlCode><ControlPosition x="666808" y="6573162" /><MapPosition x="53.86" y="-55.84" /></Control>
  <Control><ControlCode>32</ControlCode><MapPosition x="40" y="-60" /></Control>
  <Control><ControlCode>33</ControlCode><MapPosition x="45.5" y="-40" /></Control>
  <FinishPoint><FinishPointCode>FIN1</FinishPointCode><MapPosition x="60" y="-50" /></FinishPoint>
  ${courses}${extra}
</CourseData>`;
  const variation = (id: string, controls: number[], length: number, name = "") => `<CourseVariation><CourseVariationId>${id}</CourseVariationId>
    ${name ? `<Name>${name}</Name>` : ""}<CourseLength>${length}</CourseLength><StartPointCode>STA1</StartPointCode>
    ${controls.map((code, index) => `<CourseControl><Sequence>${index + 1}</Sequence><ControlCode>${code}</ControlCode><LegLength>94</LegLength></CourseControl>`).join("")}
    <FinishPointCode>FIN1</FinishPointCode><DistanceToFinish>171</DistanceToFinish></CourseVariation>`;

  it("läser banor, kontroller, längd, skala och lägen på kartan till samma modell som 3.0", () => {
    const parsed = parseIofXml(v2(`<Course><CourseName>grön</CourseName><CourseId>0</CourseId>${variation("0", [31, 32, 33], 1700)}</Course>
      <Course><CourseName>Blå</CourseName><CourseId>0</CourseId><ClassShortName>H21</ClassShortName>${variation("0", [33, 31], 2400)}</Course>`));
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    expect(parsed.mapScale).toBe(15000);
    expect(parsed.courses).toEqual([
      { externalId: "grön", name: "grön", controlCodes: [31, 32, 33], lengthMeters: 1700, startMapPosition: { x: 59.36, y: -52.77 },
        finishMapPosition: { x: 60, y: -50 } },
      { externalId: "Blå", name: "Blå", controlCodes: [33, 31], lengthMeters: 2400, startMapPosition: { x: 59.36, y: -52.77 },
        finishMapPosition: { x: 60, y: -50 } }
    ]);
    expect(parsed.controlMapPositions).toEqual([{ code: 31, x: 53.86, y: -55.84 }, { code: 32, x: 40, y: -60 }, { code: 33, x: 45.5, y: -40 }]);
    expect(parsed.controlPositions).toEqual([]);
    expect(parsed.assignments).toEqual([{ classExternalId: "H21", className: "H21", courseExternalId: "Blå", startRule: "PUNCH" }]);
    expect(parsed.warnings.some(warning => warning.includes("2.0.3"))).toBe(true);
  });

  it("sorterar kontrollerna efter Sequence och gör flera CourseVariation till en gafflad bana", () => {
    const shuffled = `<Course><CourseName>Lång</CourseName><CourseVariation><CourseVariationId>0</CourseVariationId><CourseLength>3100</CourseLength>
      <CourseControl><Sequence>2</Sequence><ControlCode>32</ControlCode></CourseControl><CourseControl><Sequence>1</Sequence><ControlCode>31</ControlCode></CourseControl>
      </CourseVariation>${variation("1", [33, 32, 31], 3300, "Lång-B")}</Course>`;
    const parsed = parseIofXml(v2(shuffled));
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    expect(parsed.courses[0]).toMatchObject({ externalId: "family:Lång", name: "Lång", controlCodes: [], lengthMeters: 3300,
      variants: [{ code: "0", controlCodes: [31, 32], lengthMeters: 3100 }, { code: "B", controlCodes: [33, 32, 31], lengthMeters: 3300 }] });
  });

  it("räknar längden ur lägena på kartan och skalan när CourseLength saknas", () => {
    const parsed = parseIofXml(v2(`<Course><CourseName>Kort</CourseName>${variation("0", [32], 0).replace("<CourseLength>0</CourseLength>", "")}</Course>`));
    if (parsed.kind !== "CourseData") throw new Error("Fel typ");
    // Start (59.36, −52.77) → 32 (40, −60) → mål (60, −50) på 1:15 000.
    const mm = Math.hypot(40 - 59.36, -60 + 52.77) + Math.hypot(60 - 40, -50 + 60);
    expect(parsed.courses[0]!.lengthMeters).toBe(Math.round(mm * 15));
  });

  it("säger vad som är fel i en trasig 2.0.3-fil", () => {
    expect(() => parseIofXml(v2(`<Course><CourseName>X</CourseName>${variation("0", [99], 100)}</Course>`))).toThrow(/okänd kontroll 99/);
    expect(() => parseIofXml(v2(""))).toThrow(/Course saknas/);
  });

  it("kräver fortfarande namnrymden för CourseData 3.0", () => {
    expect(() => parseIofXml(`<CourseData iofVersion="3.0"><Event><Name>x</Name></Event><RaceCourseData/></CourseData>`)).toThrow(/namnrymden/);
  });
});
