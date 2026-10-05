import { describe, expect, it } from "vitest";
import {
  IofResultListSerializationError,
  serializeIofResultList,
  type IofResultListEvaluatedPersonResult,
  type IofResultListPersonResult,
  type IofResultListProjection
} from "../src";

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const missingPunch: IofResultListPersonResult = {
  entryExternalId: "entry<&\"'>",
  givenName: "Ada \"A\"",
  familyName: "O'Neil & <Löpare>",
  organisationName: "Centrum & Co",
  status: "MP",
  startTime: "2026-08-31T10:00:00.001+02:00",
  finishTime: "2026-08-31T10:05:01.235+02:00",
  elapsedMs: 301_234,
  expectedControls: [
    { controlCode: 31, occurrence: 1 },
    { controlCode: 45, occurrence: 1 },
    { controlCode: 31, occurrence: 2 }
  ],
  splits: [
    { controlCode: 31, occurrence: 1, elapsedMs: 1_234 },
    { controlCode: 31, occurrence: 2, elapsedMs: 301_000 }
  ]
};

const completeOk: IofResultListEvaluatedPersonResult = {
  givenName: "Bo",
  familyName: "Löpare",
  status: "OK",
  startTime: "2026-08-31T08:10:00Z",
  finishTime: "2026-08-31T08:10:02Z",
  elapsedMs: 2_000,
  expectedControls: [],
  splits: []
};

const projection: IofResultListProjection = {
  status: "Snapshot",
  eventName: "Natt & <Sprint> \"A\"",
  classes: [
    {
      className: "H21 & \"Elit\"",
      classExternalId: "class<&\"'>",
      results: [missingPunch]
    },
    {
      className: "Öppen",
      results: [completeOk]
    }
  ]
};

const completeProof = {
  finalizationId: "11111111-1111-4111-8111-111111111111",
  revision: 3,
  sourceHash: "a".repeat(64)
};

const manualApprovalProof = {
  decisionId: "22222222-2222-4222-8222-222222222222",
  targetResultRevisionId: "33333333-3333-4333-8333-333333333333"
};

const approvedMissingSplit: IofResultListPersonResult = {
  ...missingPunch,
  status: "OK",
  manualApprovalProof
};

const didNotFinish = {
  givenName: "Ada",
  familyName: "Löpare",
  status: "DNF" as const
};

describe("serializeIofResultList", () => {
  it("skriver det beslutade IOF 3.0 Snapshot-subsetet byteexakt", () => {
    expect(text(serializeIofResultList(projection))).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid" status="Snapshot">
  <Event>
    <Name>Natt &amp; &lt;Sprint&gt; &quot;A&quot;</Name>
  </Event>
  <ClassResult timeResolution="0.001">
    <Class>
      <Id>class&lt;&amp;&quot;&apos;&gt;</Id>
      <Name>H21 &amp; &quot;Elit&quot;</Name>
    </Class>
    <PersonResult>
      <EntryId>entry&lt;&amp;&quot;&apos;&gt;</EntryId>
      <Person>
        <Name>
          <Family>O&apos;Neil &amp; &lt;Löpare&gt;</Family>
          <Given>Ada &quot;A&quot;</Given>
        </Name>
      </Person>
      <Organisation>
        <Name>Centrum &amp; Co</Name>
      </Organisation>
      <Result>
        <StartTime>2026-08-31T08:00:00.001Z</StartTime>
        <FinishTime>2026-08-31T08:05:01.235Z</FinishTime>
        <Time>301.234</Time>
        <Status>MissingPunch</Status>
        <SplitTime status="OK">
          <ControlCode>31</ControlCode>
          <Time>1.234</Time>
        </SplitTime>
        <SplitTime status="Missing">
          <ControlCode>45</ControlCode>
        </SplitTime>
        <SplitTime status="OK">
          <ControlCode>31</ControlCode>
          <Time>301</Time>
        </SplitTime>
      </Result>
    </PersonResult>
  </ClassResult>
  <ClassResult timeResolution="0.001">
    <Class>
      <Name>Öppen</Name>
    </Class>
    <PersonResult>
      <Person>
        <Name>
          <Family>Löpare</Family>
          <Given>Bo</Given>
        </Name>
      </Person>
      <Result>
        <StartTime>2026-08-31T08:10:00.000Z</StartTime>
        <FinishTime>2026-08-31T08:10:02.000Z</FinishTime>
        <Time>2</Time>
        <Status>OK</Status>
      </Result>
    </PersonResult>
  </ClassResult>
</ResultList>
`);
  });

  it("skriver en stämplad kontroll utan giltig tid som SplitTime utan Time och kräver den för OK", () => {
    const early: IofResultListEvaluatedPersonResult = { ...completeOk, elapsedMs: 2_000,
      expectedControls: [{ controlCode: 31, occurrence: 1 }, { controlCode: 32, occurrence: 1 }],
      splits: [{ controlCode: 32, occurrence: 1, elapsedMs: 1_000 }], untimedControls: [{ controlCode: 31, occurrence: 1 }] };
    const xml = text(serializeIofResultList({ status: "Snapshot", eventName: "E", classes: [{ className: "H21", results: [early] }] }));
    expect(xml).toMatch(/<SplitTime status="OK">\s*<ControlCode>31<\/ControlCode>\s*<\/SplitTime>/);
    expect(xml).toMatch(/<ControlCode>32<\/ControlCode>\s*<Time>1<\/Time>/);
    const { untimedControls: _untimed, ...withoutUntimed } = early;
    void _untimed;
    expect(() => serializeIofResultList({ status: "Snapshot", eventName: "E", classes: [{ className: "H21", results: [withoutUntimed] }] }))
      .toThrowError(/split för varje förväntad kontroll/);
  });

  it("ger identiska UTF-8-bytes och bevarar projektionens ordning", () => {
    const first = serializeIofResultList(projection);
    for (let index = 0; index < 100; index += 1) {
      expect(serializeIofResultList(projection)).toEqual(first);
    }
    const xml = text(first);
    expect(xml.indexOf("H21")).toBeLessThan(xml.indexOf("Öppen"));
    expect(xml.endsWith("\n")).toBe(true);
    expect(xml).not.toContain("createTime");
  });

  it("skriver explicit Complete-root med giltigt internt finaliseringsbevis", () => {
    const completeProjection = {
      ...projection,
      status: "Complete" as const,
      finalizationProof: completeProof
    };
    const xml = text(serializeIofResultList(completeProjection));
    expect(xml).toContain('<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid" status="Complete">');
    expect(xml).not.toContain(completeProof.finalizationId);
    expect(xml).not.toContain(completeProof.sourceHash);
    expect(xml).not.toContain("finalizationProof");
  });

  it("avvisar Complete utan finaliseringsbevis", () => {
    expect(() => serializeIofResultList({
      ...projection,
      status: "Complete"
    } as unknown as IofResultListProjection)).toThrowError(/Complete kräver finalizationProof/);
  });

  it("avvisar Snapshot som bär ett finaliseringsbevis", () => {
    expect(() => serializeIofResultList({
      ...projection,
      finalizationProof: completeProof
    } as unknown as IofResultListProjection)).toThrowError(/Snapshot får inte ha finalizationProof/);
  });

  it.each([
    ["UUID med versal", { finalizationId: "11111111-1111-4111-8111-11111111111A" }],
    ["UUID med ogiltig version", { finalizationId: "11111111-1111-0111-8111-111111111111" }],
    ["icke-positiv revision", { revision: 0 }],
    ["bråkrevision", { revision: 1.5 }],
    ["versalt hashtecken", { sourceHash: `${"a".repeat(63)}A` }],
    ["för kort hash", { sourceHash: "a".repeat(63) }]
  ])("avvisar ogiltigt Complete-bevis: %s", (_name, change) => {
    expect(() => serializeIofResultList({
      ...projection,
      status: "Complete",
      finalizationProof: { ...completeProof, ...change }
    } as unknown as IofResultListProjection)).toThrowError(/finalizationProof/);
  });

  it("skriver ranking i IOF-ordning och ignorerar okända interna projektionsfält", () => {
    const internalUuid = "11111111-1111-4111-8111-111111111111";
    const withInternalFields = {
      ...projection,
      raceId: internalUuid,
      classes: projection.classes.map((raceClass, classIndex) => ({
        ...raceClass,
        classId: internalUuid,
        results: raceClass.results.map((result) => ({
          ...result,
          entryId: internalUuid,
          courseVersionId: internalUuid,
          ...(classIndex === 1 ? { position: 1, timeBehindMs: 0 } : {})
        }))
      }))
    };
    const xml = text(serializeIofResultList(withInternalFields as unknown as IofResultListProjection));
    expect(xml).not.toContain(internalUuid);
    expect(xml).toContain("<TimeBehind>0</TimeBehind>");
    expect(xml).toContain("<Position>1</Position>");
    expect(xml.indexOf("<TimeBehind>0</TimeBehind>")).toBeLessThan(xml.indexOf("<Position>1</Position>"));
    expect(xml.indexOf("<Position>1</Position>")).toBeLessThan(xml.indexOf("<Status>OK</Status>"));
    expect(xml).not.toContain("raceNumber");
    expect(xml).not.toContain("Extensions");
  });

  it("skriver tid efter ledaren som exakta decimalsekunder", () => {
    const xml = text(serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Bo",
          familyName: "Löpare",
          status: "OK",
          startTime: "2026-08-31T08:00:00Z",
          finishTime: "2026-08-31T08:05:01.234Z",
          elapsedMs: 301_234,
          position: 2,
          timeBehindMs: 1_234,
          expectedControls: [],
          splits: []
        }]
      }]
    }));
    const timeIndex = xml.indexOf("<Time>301.234</Time>");
    const behindIndex = xml.indexOf("<TimeBehind>1.234</TimeBehind>");
    const positionIndex = xml.indexOf("<Position>2</Position>");
    const statusIndex = xml.indexOf("<Status>OK</Status>");
    expect(timeIndex).toBeGreaterThan(-1);
    expect(behindIndex).toBeGreaterThan(timeIndex);
    expect(positionIndex).toBeGreaterThan(behindIndex);
    expect(statusIndex).toBeGreaterThan(positionIndex);
  });

  it.each([
    ["OK utan position", { position: 1 }, /måste anges tillsammans/],
    ["OK utan timeBehind", { timeBehindMs: 0 }, /måste anges tillsammans/],
    ["MP med rankingpar", { status: "MP", position: 1, timeBehindMs: 0 }, /får bara anges för status OK/],
    ["MP med delvis ranking", { status: "MP", position: 1 }, /måste anges tillsammans/]
  ])("avvisar ofullständigt eller felaktigt rankingpar: %s", (_name, ranking, pattern) => {
    const status: IofResultListPersonResult["status"] =
      "status" in ranking && ranking.status === "MP" ? "MP" : "OK";
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          startTime: "2026-08-31T08:00:00Z",
          finishTime: "2026-08-31T08:00:01Z",
          elapsedMs: 1_000,
          ...ranking,
          status,
          expectedControls: [],
          splits: []
        }]
      }]
    })).toThrowError(pattern);
  });

  it.each([
    ["noll", { position: 0, timeBehindMs: 0 }, /position måste vara ett positivt/],
    ["bråkposition", { position: 1.5, timeBehindMs: 0 }, /position måste vara ett positivt/],
    ["osäker position", { position: Number.MAX_SAFE_INTEGER + 1, timeBehindMs: 0 }, /position måste vara ett positivt/],
    ["negativ tid efter", { position: 1, timeBehindMs: -1 }, /timeBehindMs måste vara ett icke-negativt/],
    ["icke-finit tid efter", { position: 1, timeBehindMs: Number.NaN }, /timeBehindMs måste vara ett icke-negativt/],
    ["oändlig tid efter", { position: 1, timeBehindMs: Number.POSITIVE_INFINITY }, /timeBehindMs måste vara ett icke-negativt/],
    ["osäker tid efter", { position: 1, timeBehindMs: Number.MAX_SAFE_INTEGER + 1 }, /timeBehindMs måste vara ett icke-negativt/]
  ])("avvisar osäkra rankingvärden: %s", (_name, ranking, pattern) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "OK",
          startTime: "2026-08-31T08:00:00Z",
          finishTime: "2026-08-31T08:00:01Z",
          elapsedMs: 1_000,
          ...ranking,
          expectedControls: [],
          splits: []
        }]
      }]
    })).toThrowError(pattern);
  });

  it("skriver en MP utan kända tider och alla förväntade kontroller som Missing", () => {
    const xml = text(serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "MP",
          expectedControls: [
            { controlCode: 31, occurrence: 1 },
            { controlCode: 31, occurrence: 2 }
          ],
          splits: []
        }]
      }]
    }));
    expect(xml).not.toContain("<StartTime>");
    expect(xml).not.toContain("<FinishTime>");
    expect(xml).not.toContain("<Time>");
    expect(xml.match(/status="Missing"/g)).toHaveLength(2);
    expect(xml).toContain("<Status>MissingPunch</Status>");
  });

  it("mappar DNS till ett status-only DidNotStart-resultat", () => {
    const xml = text(serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "DNS",
          expectedControls: [],
          splits: []
        }]
      }]
    }));
    const result = xml.slice(xml.indexOf("<Result>"), xml.indexOf("</Result>") + "</Result>".length);
    expect(result).toBe(`<Result>\n        <Status>DidNotStart</Status>\n      </Result>`);
    expect(result).not.toMatch(/StartTime|FinishTime|<Time>|TimeBehind|Position|SplitTime/);
  });

  it.each(["Snapshot", "Complete"] as const)(
    "mappar status-only DNF till endast DidNotFinish i %s",
    (status) => {
      const dnfProjection: IofResultListProjection = status === "Complete"
        ? {
            status,
            eventName: "Test",
            finalizationProof: completeProof,
            classes: [{ className: "H21", results: [didNotFinish] }]
          }
        : {
            status,
            eventName: "Test",
            classes: [{ className: "H21", results: [didNotFinish] }]
          };
      const xml = text(serializeIofResultList(dnfProjection));
      const result = xml.slice(xml.indexOf("<Result>"), xml.indexOf("</Result>") + "</Result>".length);
      expect(result).toBe(`<Result>\n        <Status>DidNotFinish</Status>\n      </Result>`);
      expect(result).not.toMatch(/StartTime|FinishTime|<Time>|TimeBehind|Position|SplitTime/);
      expect(xml).not.toContain(completeProof.finalizationId);
      expect(xml).not.toContain(completeProof.sourceHash);
    }
  );

  it.each([
    ["starttid", { startTime: "2026-08-31T08:00:00Z" }],
    ["måltid", { finishTime: "2026-08-31T08:00:01Z" }],
    ["elapsed", { elapsedMs: 1_000 }],
    ["ranking", { position: 1, timeBehindMs: 0 }],
    ["tom kontrollista", { expectedControls: [] }],
    ["tom splitlista", { splits: [] }],
    ["approvalbevis", { manualApprovalProof }]
  ])("avvisar DNF som bär %s fail closed", (_name, mutation) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{ className: "H21", results: [{ ...didNotFinish, ...mutation }] }]
    } as unknown as IofResultListProjection)).toThrowError(/status DNF måste vara status-only/);
  });

  it("mappar DSQ till Disqualified med bevarade tider och splits men utan ranking", () => {
    const xml = text(serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          ...missingPunch,
          status: "DSQ"
        }]
      }]
    }));
    expect(xml).toContain("<Status>Disqualified</Status>");
    expect(xml).toContain("<StartTime>2026-08-31T08:00:00.001Z</StartTime>");
    expect(xml).toContain("<Time>301.234</Time>");
    expect(xml).toContain('<SplitTime status="Missing">');
    expect(xml).not.toMatch(/TimeBehind|Position/);
  });

  it.each(["Snapshot", "Complete"] as const)(
    "mappar explicit OOC till NotCompeting med teknisk fakta men utan ranking/proof i %s",
    (status) => {
      const outOfCompetition: IofResultListPersonResult = {
        entryExternalId: "entry<&\"'>",
        givenName: "Ada \"A\"",
        familyName: "O'Neil & <Löpare>",
        organisationName: "Centrum & Co",
        status: "OOC",
        startTime: "2026-08-31T10:00:00.001+02:00",
        finishTime: "2026-08-31T10:05:01.235+02:00",
        elapsedMs: 301_234,
        expectedControls: [
          { controlCode: 31, occurrence: 1 },
          { controlCode: 45, occurrence: 1 },
          { controlCode: 31, occurrence: 2 }
        ],
        splits: [
          { controlCode: 31, occurrence: 1, elapsedMs: 1_234 },
          { controlCode: 31, occurrence: 2, elapsedMs: 301_000 }
        ]
      };
      const outOfCompetitionProjection: IofResultListProjection = status === "Complete"
        ? {
            status,
            eventName: "Test",
            finalizationProof: completeProof,
            classes: [{ className: "H21", results: [outOfCompetition] }]
          }
        : {
            status,
            eventName: "Test",
            classes: [{ className: "H21", results: [outOfCompetition] }]
          };
      const xml = text(serializeIofResultList(outOfCompetitionProjection));
      expect(xml).toContain("<Status>NotCompeting</Status>");
      expect(xml).toContain("<StartTime>2026-08-31T08:00:00.001Z</StartTime>");
      expect(xml).toContain("<FinishTime>2026-08-31T08:05:01.235Z</FinishTime>");
      expect(xml).toContain("<Time>301.234</Time>");
      expect(xml).toContain('<SplitTime status="Missing">');
      expect(xml).not.toMatch(/TimeBehind|Position|manualApprovalProof/);
      expect(xml).not.toContain(completeProof.finalizationId);
    }
  );

  it("serialiserar en restaurerad teknisk OK eller MP utan ny IOF-status", () => {
    const restoredOk = { ...completeOk, position: 1, timeBehindMs: 0 } as IofResultListPersonResult;
    const restoredMp = { ...missingPunch, status: "MP" as const } as IofResultListPersonResult;
    const xml = text(serializeIofResultList({
      status: "Snapshot",
      eventName: "Återtagande",
      classes: [{ className: "H21", results: [restoredOk, restoredMp] }]
    }));
    expect(xml).toContain("<Status>OK</Status>");
    expect(xml).toContain("<Status>MissingPunch</Status>");
    expect(xml).not.toContain("NotCompeting");
  });

  it.each([
    ["ranking", { position: 1, timeBehindMs: 0 }],
    ["delvis ranking", { position: 1 }],
    ["approvalbevis", { manualApprovalProof }],
    ["mål utan start", { startTime: undefined }],
    ["splits utan totaltid", { elapsedMs: undefined }]
  ])("avvisar OOC med %s fail closed", (_name, mutation) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{ className: "H21", results: [{ ...missingPunch, status: "OOC", ...mutation }] }]
    } as unknown as IofResultListProjection)).toThrowError(
      /får bara anges för status OK|manualApprovalProof får bara anges för status OK|utan startTime|utan elapsedMs/
    );
  });

  it.each(["Snapshot", "Complete"] as const)(
    "skriver manuellt godkänt OK med saknad split sanningsenligt i %s utan proof-läckage",
    (status) => {
      const projection: IofResultListProjection = status === "Complete"
        ? { status, eventName: "Test", finalizationProof: completeProof,
            classes: [{ className: "H21", results: [approvedMissingSplit] }] }
        : { status, eventName: "Test",
            classes: [{ className: "H21", results: [approvedMissingSplit] }] };
      const xml = text(serializeIofResultList(projection));
      expect(xml).toContain(`<ResultList `);
      expect(xml).toContain(`<Status>OK</Status>`);
      expect(xml).toContain('<SplitTime status="Missing">');
      expect(xml).toContain("<ControlCode>45</ControlCode>");
      expect(xml).not.toContain('<ControlCode>45</ControlCode>\n          <Time>');
      expect(xml).not.toContain(manualApprovalProof.decisionId);
      expect(xml).not.toContain(manualApprovalProof.targetResultRevisionId);
      expect(xml).not.toContain("manualApprovalProof");
      if (status === "Complete") {
        expect(xml).toContain('status="Complete"');
        expect(xml).not.toContain(completeProof.finalizationId);
      } else {
        expect(xml).toContain('status="Snapshot"');
      }
    }
  );

  it("tillåter proof på ett komplett OK men kräver full splitcoverage utan proof", () => {
    const completeOk: IofResultListPersonResult = {
      ...approvedMissingSplit,
      expectedControls: [{ controlCode: 31, occurrence: 1 }],
      splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 1_234 }]
    };
    expect(() => serializeIofResultList({
      status: "Snapshot", eventName: "Test",
      classes: [{ className: "H21", results: [completeOk] }]
    })).not.toThrow();
    const completeOkWithoutProof = { ...completeOk };
    delete completeOkWithoutProof.manualApprovalProof;
    expect(() => serializeIofResultList({
      status: "Snapshot", eventName: "Test",
      classes: [{ className: "H21", results: [completeOkWithoutProof] }]
    })).not.toThrow();
    const approvedMissingSplitWithoutProof = { ...approvedMissingSplit };
    delete approvedMissingSplitWithoutProof.manualApprovalProof;
    expect(() => serializeIofResultList({
      status: "Snapshot", eventName: "Test",
      classes: [{ className: "H21", results: [approvedMissingSplitWithoutProof] }]
    })).toThrowError(/status OK måste ha en split/);
  });

  it("avvisar proof på annan status och proof med extra eller ogiltiga fält", () => {
    const base = {
      status: "Snapshot" as const,
      eventName: "Test",
      classes: [{ className: "H21", results: [approvedMissingSplit] }]
    };
    expect(() => serializeIofResultList({
      ...base,
      classes: [{ className: "H21", results: [{ ...approvedMissingSplit, status: "MP", manualApprovalProof }] }]
    })).toThrowError(/manualApprovalProof får bara anges för status OK/);
    expect(() => serializeIofResultList({
      ...base,
      classes: [{ className: "H21", results: [{
        ...approvedMissingSplit,
        manualApprovalProof: { ...manualApprovalProof, extra: "läckage" }
      }] }]
    } as unknown as IofResultListProjection)).toThrowError(/manualApprovalProof\.extra är inte tillåten/);
    expect(() => serializeIofResultList({
      ...base,
      classes: [{ className: "H21", results: [{
        ...approvedMissingSplit,
        manualApprovalProof: { ...manualApprovalProof, decisionId: "not-a-uuid" }
      }] }]
    })).toThrowError(/manualApprovalProof\.decisionId måste vara ett kanoniskt/);
  });

  it("avvisar ranking på DSQ", () => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{ ...missingPunch, status: "DSQ", position: 1, timeBehindMs: 0 }]
      }]
    })).toThrowError(/får bara anges för status OK/);
  });

  it.each([
    ["starttid", { startTime: "2026-08-31T08:00:00Z" }, /DNS måste vara status-only/],
    ["sluttid", { elapsedMs: 1 }, /DNS måste vara status-only/],
    ["ranking", { position: 1, timeBehindMs: 0 }, /får bara anges för status OK/],
    ["kontroll", { expectedControls: [{ controlCode: 31, occurrence: 1 }] }, /DNS får inte ha kontroller/],
    ["split", { splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 1 }] }, /DNS får inte ha kontroller/]
  ])("avvisar DNS med %s", (_name, mutation, pattern) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "DNS",
          expectedControls: [],
          splits: [],
          ...mutation
        }]
      }]
    })).toThrowError(pattern);
  });

  it.each([
    ["NUL", "Noll\u0000tecken", /XML 1\.0/],
    ["oparat högt surrogat", "Hög\ud800", /oparat UTF-16-surrogat/],
    ["oparat lågt surrogat", "Låg\udc00", /oparat UTF-16-surrogat/]
  ])("avvisar %s i XML-text", (_name, eventName, pattern) => {
    expect(() => serializeIofResultList({ status: "Snapshot", eventName, classes: [] }))
      .toThrowError(pattern);
  });

  it("tillåter giltiga supplementary Unicode-kodpunkter", () => {
    expect(text(serializeIofResultList({ status: "Snapshot", eventName: "Natt 🧭", classes: [] })))
      .toContain("<Name>Natt 🧭</Name>");
  });

  it.each([
    ["OK utan alla splits", {
      ...completeOk,
      expectedControls: [{ controlCode: 31, occurrence: 1 }]
    }, /status OK måste ha en split/],
    ["split utanför banan", {
      ...missingPunch,
      splits: [{ controlCode: 99, occurrence: 1, elapsedMs: 1_000 }]
    }, /hör inte till den historiska bansekvensen/],
    ["fel occurrence", {
      ...missingPunch,
      expectedControls: [{ controlCode: 31, occurrence: 2 }]
    }, /occurrence måste vara 1/],
    ["motsägande totaltid", {
      ...missingPunch,
      elapsedMs: 1
    }, /motsvarar inte skillnaden/],
    ["fallande splittid", {
      ...missingPunch,
      expectedControls: [
        { controlCode: 31, occurrence: 1 },
        { controlCode: 32, occurrence: 1 }
      ],
      splits: [
        { controlCode: 31, occurrence: 1, elapsedMs: 2_000 },
        { controlCode: 32, occurrence: 1, elapsedMs: 1_000 }
      ]
    }, /icke-avtagande/]
  ])("avvisar motsägande projektion: %s", (_name, result, pattern) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{ className: "H21", results: [result] }]
    })).toThrowError(pattern);
  });

  it.each([
    "2026-02-30T08:00:00Z",
    "2026-08-31T25:00:00Z",
    "2026-08-31T08:00:00",
    "2026-08-31T08:00:00+15:00"
  ])("avvisar ogiltig eller zonlös tid %s", (startTime) => {
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "MP",
          startTime,
          expectedControls: [],
          splits: []
        }]
      }]
    })).toThrow(IofResultListSerializationError);
  });

  it("begränsar historisk bansplits till 256", () => {
    const expectedControls = Array.from({ length: 257 }, (_, index) => ({
      controlCode: index + 1,
      occurrence: 1
    }));
    expect(() => serializeIofResultList({
      status: "Snapshot",
      eventName: "Test",
      classes: [{
        className: "H21",
        results: [{
          givenName: "Ada",
          familyName: "Löpare",
          status: "MP",
          expectedControls,
          splits: []
        }]
      }]
    })).toThrow(/högst 256/);
  });
});
