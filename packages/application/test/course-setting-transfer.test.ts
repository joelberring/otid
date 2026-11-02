import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyEdit, readPpen } from "@o-tid/course-setting";
import { parseIofXml } from "@o-tid/iof-xml";
import { classNamesOf, courseSettingProjection } from "../src/course-setting-transfer";

/**
 * Steg 62 (ADR-0180 beslut 1, 6): "Överför till tävlingen" ska ge samma banfil som om banläggaren exporterat IOF XML 3.0
 * ur Purple Pen och läst in den. Filen nedan är skriven som Purple Pens `ExportXmlVersion3` skriver fixturens banor (utan
 * georeferens: inga Position).
 */
const purplePenExport = `<?xml version="1.0" encoding="utf-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-10-31T20:00:00+01:00" creator="Purple Pen version 3.5.0">
  <Event><Name>Kvällsträning på kartfilen</Name></Event>
  <RaceCourseData>
    <Map><Scale>10000</Scale><MapPositionTopLeft x="-10" y="90" /><MapPositionBottomRight x="110" y="-10" /></Map>
    <Control type="Start"><Id>STA1</Id><MapPosition x="4" y="8" /></Control>
    <Control type="Control"><Id>31</Id><MapPosition x="15" y="42" /></Control>
    <Control type="Control"><Id>32</Id><MapPosition x="42" y="61" /></Control>
    <Control type="Control"><Id>33</Id><MapPosition x="76" y="52" /></Control>
    <Control type="Control"><Id>34</Id><MapPosition x="98" y="30" /></Control>
    <Control type="Control"><Id>35</Id><MapPosition x="82" y="9" /></Control>
    <Control type="Control"><Id>36</Id><MapPosition x="50" y="18" /></Control>
    <Control type="Control"><Id>37</Id><MapPosition x="26" y="76" /></Control>
    <Control type="Finish"><Id>FIN1</Id><MapPosition x="12" y="4" /></Control>
    <Course><Name>Lång</Name><Length>2400</Length>
      <CourseControl type="Start"><Control>STA1</Control></CourseControl>
      <CourseControl type="Control"><Control>31</Control><MapText>1</MapText><LegLength>354</LegLength></CourseControl>
      <CourseControl type="Control"><Control>32</Control><MapText>2</MapText><LegLength>330</LegLength></CourseControl>
      <CourseControl type="Control"><Control>33</Control><MapText>3</MapText><LegLength>352</LegLength></CourseControl>
      <CourseControl type="Control"><Control>34</Control><MapText>4</MapText><LegLength>311</LegLength></CourseControl>
      <CourseControl type="Control"><Control>35</Control><MapText>5</MapText><LegLength>264</LegLength></CourseControl>
      <CourseControl type="Control"><Control>36</Control><MapText>6</MapText><LegLength>334</LegLength></CourseControl>
      <CourseControl type="Finish"><Control>FIN1</Control><LegLength>397</LegLength></CourseControl>
    </Course>
    <Course><Name>Mellan A</Name><CourseFamily>Mellan</CourseFamily><Length>1900</Length>
      <CourseControl type="Start"><Control>STA1</Control></CourseControl>
      <CourseControl type="Control"><Control>31</Control><MapText>1</MapText></CourseControl>
      <CourseControl type="Control"><Control>32</Control><MapText>2</MapText></CourseControl>
      <CourseControl type="Control"><Control>33</Control><MapText>3</MapText></CourseControl>
      <CourseControl type="Control"><Control>36</Control><MapText>4</MapText></CourseControl>
      <CourseControl type="Finish"><Control>FIN1</Control></CourseControl>
    </Course>
    <Course><Name>Mellan B</Name><CourseFamily>Mellan</CourseFamily><Length>2100</Length>
      <CourseControl type="Start"><Control>STA1</Control></CourseControl>
      <CourseControl type="Control"><Control>31</Control><MapText>1</MapText></CourseControl>
      <CourseControl type="Control"><Control>37</Control><MapText>2</MapText></CourseControl>
      <CourseControl type="Control"><Control>33</Control><MapText>3</MapText></CourseControl>
      <CourseControl type="Control"><Control>36</Control><MapText>4</MapText></CourseControl>
      <CourseControl type="Finish"><Control>FIN1</Control></CourseControl>
    </Course>
    <ClassCourseAssignment><ClassName>H21</ClassName><CourseName>Lång</CourseName></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21</ClassName><CourseName>Mellan A</CourseName><CourseFamily>Mellan</CourseFamily></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21</ClassName><CourseName>Mellan B</CourseName><CourseFamily>Mellan</CourseFamily></ClassCourseAssignment>
  </RaceCourseData>
</CourseData>`;

describe("banläggningen som banfil", () => {
  it("ger samma banor, varianter, klasser och kartlägen som Purple Pens IOF-export", async () => {
    const ppen = await readFile(new URL("../../../fixtures/course-setting/kartfil.ppen", import.meta.url), "utf8");
    const built = courseSettingProjection(readPpen(ppen).document);
    if (!("projection" in built)) throw new Error(built.problem.error);
    const parsed = parseIofXml(purplePenExport);
    if (parsed.kind !== "CourseData") throw new Error("Inte en banfil");
    const { data } = built.projection;
    expect(data.courses).toEqual(parsed.courses);
    expect(data.assignments).toEqual(parsed.assignments);
    expect(data.controlMapPositions).toEqual(parsed.controlMapPositions);
    expect(data.controlPositions).toEqual(parsed.controlPositions);
    expect(data.mapScale).toBe(parsed.mapScale);
    expect(data.warnings).toEqual(parsed.warnings);
  });

  it("läser klasserna ur undertiteln som Purple Pen", () => {
    expect(classNamesOf(" H21, D21 | H20 ")).toEqual(["H21", "D21", "H20"]);
    expect(classNamesOf(undefined)).toEqual([]);
  });

  it("ADR-0190: stigning och fast längd följer med (avrundade som Purple Pen), och ordningen ändrar inga banor", async () => {
    const ppen = await readFile(new URL("../../../fixtures/course-setting/kartfil.ppen", import.meta.url), "utf8");
    let document = readPpen(ppen).document;
    const lang = document.courses.find(course => course.name === "Lång")!;
    document = applyEdit(document, { type: "UPDATE_COURSE", course: lang.id, changes: { climbMeters: 83, lengthOverrideMeters: 2640 } }).document;
    const built = courseSettingProjection(document);
    if (!("projection" in built)) throw new Error(built.problem.error);
    expect(built.projection.data.courses.find(course => course.name === "Lång")).toMatchObject({ lengthMeters: 2600, climbMeters: 85 });
    const moved = applyEdit(document, { type: "UPDATE_COURSE", course: lang.id, changes: { order: document.courses.length } }).document;
    const again = courseSettingProjection(moved);
    if (!("projection" in again)) throw new Error(again.problem.error);
    const byName = (courses: readonly { name: string }[]) => [...courses].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(again.projection.data.courses)).toEqual(byName(built.projection.data.courses));
    expect(again.projection.data.courses.at(-1)!.name).toBe("Lång");
  });
});
