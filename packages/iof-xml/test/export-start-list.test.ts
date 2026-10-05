import { describe, expect, it } from "vitest";
import { IofStartListSerializationError, serializeIofStartList, type IofStartListProjection } from "../src";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const projection: IofStartListProjection = {
  eventName: "Natt & <Sprint> \"A\"",
  classes: [{
    className: "H21 & \"Elit\"",
    startRule: "FIXED",
    starts: [{
      givenName: "Ada \"A\"",
      familyName: "O'Neil & <Löpare>",
      organisationName: "Centrum & Co",
      startTime: "2026-08-31T10:00:00.001+02:00"
    }, { givenName: "Bo", familyName: "Löpare" }]
  }, {
    className: "Öppen",
    startRule: "PUNCH",
    starts: [{ givenName: "Åsa", familyName: "Öberg" }]
  }]
};

describe("serializeIofStartList", () => {
  it("skriver det avgränsade IOF 3.0 StartList-subsetet byteexakt", () => {
    expect(text(serializeIofStartList(projection))).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid">
  <Event>
    <Name>Natt &amp; &lt;Sprint&gt; &quot;A&quot;</Name>
  </Event>
  <ClassStart>
    <Class>
      <Name>H21 &amp; &quot;Elit&quot;</Name>
    </Class>
    <PersonStart>
      <Person>
        <Name>
          <Family>O&apos;Neil &amp; &lt;Löpare&gt;</Family>
          <Given>Ada &quot;A&quot;</Given>
        </Name>
      </Person>
      <Organisation>
        <Name>Centrum &amp; Co</Name>
      </Organisation>
      <Start>
        <StartTime>2026-08-31T08:00:00.001Z</StartTime>
      </Start>
    </PersonStart>
    <PersonStart>
      <Person>
        <Name>
          <Family>Löpare</Family>
          <Given>Bo</Given>
        </Name>
      </Person>
      <Start/>
    </PersonStart>
  </ClassStart>
  <ClassStart>
    <Class>
      <Name>Öppen</Name>
    </Class>
    <PersonStart>
      <Person>
        <Name>
          <Family>Öberg</Family>
          <Given>Åsa</Given>
        </Name>
      </Person>
      <Start/>
    </PersonStart>
  </ClassStart>
</StartList>
`);
  });

  it("bevarar ordning och skriver aldrig privat eller osann IOF-data", () => {
    const xml = text(serializeIofStartList(projection));
    expect(xml.indexOf("H21")).toBeLessThan(xml.indexOf("Öppen"));
    expect(xml).not.toMatch(/EntryId|<Id>|raceNumber|Status|BibNumber|Course|ControlCard|createTime/);
    expect(serializeIofStartList(projection)).toEqual(serializeIofStartList(projection));
  });

  it.each([
    ["PUNCH med tid", { ...projection, classes: [{ ...projection.classes[1]!, starts: [{ givenName: "A", familyName: "B", startTime: "2026-08-31T10:00:00Z" }] }] }, /PUNCH/],
    ["PUNCH med explicit undefined-tid", { ...projection, classes: [{ ...projection.classes[1]!, starts: [{ givenName: "A", familyName: "B", startTime: undefined }] }] }, /PUNCH/],
    ["tid utan offset", { ...projection, classes: [{ ...projection.classes[0]!, starts: [{ givenName: "A", familyName: "B", startTime: "2026-08-31T10:00:00" }] }] }, /UTC-zon/],
    ["ogiltigt datum", { ...projection, classes: [{ ...projection.classes[0]!, starts: [{ givenName: "A", familyName: "B", startTime: "2026-02-30T10:00:00Z" }] }] }, /ogiltig ISO/],
    ["nanosekunder", { ...projection, classes: [{ ...projection.classes[0]!, starts: [{ givenName: "A", familyName: "B", startTime: "2026-08-31T10:00:00.1234Z" }] }] }, /millisekundprecision/],
    ["XML-kontrolltecken", { ...projection, eventName: "A\u0001B" }, /XML 1.0/],
    ["okänt rotfält", { ...projection, hidden: true }, /hidden/],
    ["okänt startfält", { ...projection, classes: [{ ...projection.classes[0]!, starts: [{ givenName: "A", familyName: "B", id: "private" }] }] }, /\.id/],
    ["tom lista", { eventName: "Test", classes: [] }, /minst en PersonStart/]
  ])("avvisar %s", (_name, value, pattern) => {
    expect(() => serializeIofStartList(value as unknown as IofStartListProjection)).toThrowError(pattern);
  });

  it("skriver stafettlag som TeamStart med sträcka och starttid bara där den finns", () => {
    const xml = text(serializeIofStartList({ eventName: "Klubbstafett", classes: [{ className: "Stafett", startRule: "FIXED", starts: [],
      teamStarts: [{ name: "OK Ek 1", bibNumber: 1, organisationName: "OK Ek", members: [
        { leg: 1, givenName: "Anna", familyName: "Ek", startTime: "2026-08-31T10:00:00Z" },
        { leg: 2, givenName: "Bo", familyName: "Ek", organisationName: "OK Ek" }] }] }] }));
    expect(xml).toContain(`    <TeamStart>
      <Name>OK Ek 1</Name>
      <Organisation>
        <Name>OK Ek</Name>
      </Organisation>
      <BibNumber>1</BibNumber>
      <TeamMemberStart>
        <Person>
          <Name>
            <Family>Ek</Family>
            <Given>Anna</Given>
          </Name>
        </Person>
        <Start>
          <Leg>1</Leg>
          <StartTime>2026-08-31T10:00:00.000Z</StartTime>
        </Start>
      </TeamMemberStart>`);
    expect(xml).toContain(`        <Start>
          <Leg>2</Leg>
        </Start>`);
    expect(xml).not.toContain("<PersonStart>");
  });

  it("avvisar stafettlag med sträckor i fel ordning", () => {
    expect(() => serializeIofStartList({ eventName: "Test", classes: [{ className: "Stafett", startRule: "FIXED", starts: [],
      teamStarts: [{ name: "Lag", bibNumber: 1, members: [{ leg: 2, givenName: "A", familyName: "B" }, { leg: 1, givenName: "C", familyName: "D" }] }] }] }))
      .toThrowError(/sträckor i ordning/);
  });

  it("avvisar gränser", () => {
    const tooManyClasses = Array.from({ length: 1_001 }, () => ({ className: "H21", startRule: "PUNCH" as const, starts: [] }));
    expect(() => serializeIofStartList({ eventName: "Test", classes: tooManyClasses })).toThrowError(/1000/);
    const tooManyStarts = Array.from({ length: 10_001 }, () => ({ givenName: "A", familyName: "B" }));
    expect(() => serializeIofStartList({ eventName: "Test", classes: [{ className: "H21", startRule: "PUNCH", starts: tooManyStarts }] })).toThrowError(/10000/);
  });

  it("exponerar explicita serialiseringsfel", () => {
    expect(() => serializeIofStartList(null as unknown as IofStartListProjection)).toThrow(IofStartListSerializationError);
  });
});
