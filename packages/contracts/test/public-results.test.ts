import { describe, expect, it } from "vitest";
import {
  publicResultListResponseSchema,
  publicResultListResponseV7Schema,
  publicResultDetailResponseSchema
} from "../src";

const publicResultId = "8d9f3135-5888-4e0c-b31e-fc2a5d81d627";

const ranked = {
  className: "H21",
  givenName: "Ada",
  familyName: "Löpare",
  organisationName: "Centrum OK",
  publicResultId,
  revision: 2,
  status: "OK" as const,
  reason: "COMPLETE" as const,
  elapsedMs: 3_600_123,
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_001, legMs: 600_001 }],
  missingControls: [] as number[],
  extraPunches: [] as number[],
  rankingState: "RANKED" as const,
  position: 1,
  timeBehindMs: 0
};

const accepts = (...results: unknown[]): boolean =>
  publicResultListResponseSchema.safeParse({ formatVersion: 7, results }).success;

describe("publicResultListResponseSchema", () => {
  it("accepterar en minimal strikt publik ranking utan interna id:n", () => {
    const parsed = publicResultListResponseSchema.parse({ formatVersion: 7, results: [ranked] });
    expect(parsed.results[0]).toEqual(ranked);
    expect(JSON.stringify(parsed)).not.toMatch(/entryId|classId|courseVersionId|readoutId|resultRevisionId/);
  });

  it("avvisar andra format än 7", () => {
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 6, results: [ranked] }).success).toBe(false);
  });

  it.each([
    ["halvt rankingpar", { ...ranked, timeBehindMs: undefined }],
    ["ranking på MP", { ...ranked, status: "MP", reason: "MISSING_CONTROL" }],
    ["blandad bana med position", { ...ranked, rankingState: "MIXED_COURSE_VERSIONS" }],
    ["tid efter större än totaltid", { ...ranked, timeBehindMs: ranked.elapsedMs + 1 }],
    ["okänt fält", { ...ranked, entryId: "11111111-1111-4111-8111-111111111111" }]
  ])("avvisar %s", (_name, result) => {
    expect(accepts(result)).toBe(false);
  });

  it("accepterar MP och mixed-course OK endast utan rankingfält", () => {
    expect(accepts(
      { ...ranked, status: "MP", reason: "MISSING_CONTROL", rankingState: "NOT_RANKABLE_STATUS",
        position: undefined, timeBehindMs: undefined },
      { ...ranked, rankingState: "MIXED_COURSE_VERSIONS", position: undefined, timeBehindMs: undefined }
    )).toBe(true);
  });

  it("accepterar DNS endast som publik status-only-rad", () => {
    const dns = { ...ranked, status: "DNS" as const, reason: "DID_NOT_START" as const, elapsedMs: undefined, splits: [],
      rankingState: "NOT_RANKABLE_STATUS" as const, position: undefined, timeBehindMs: undefined };
    expect(accepts(dns)).toBe(true);
    expect(accepts({ ...dns, elapsedMs: 1 })).toBe(false);
    expect(accepts({ ...dns, splits: ranked.splits })).toBe(false);
  });
});

describe("publikt manuellt godkännande", () => {
  const approved = { ...ranked, reason: "MANUAL_APPROVAL" as const, missingControls: [45], extraPunches: [99] };

  it("rankar ett tidsatt godkänt resultat utan intern decisionproveniens", () => {
    const parsed = publicResultListResponseSchema.parse({ formatVersion: 7, results: [approved] });
    expect(parsed.results[0]).toEqual(approved);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|approvalProof/);
  });

  it("förbjuder approval-reason för MP", () => {
    expect(accepts({ ...approved, status: "MP", rankingState: "NOT_RANKABLE_STATUS", position: undefined,
      timeBehindMs: undefined })).toBe(false);
  });
});

describe("publik DSQ", () => {
  const disqualified = { ...ranked, status: "DSQ" as const, reason: "MANUAL_DISQUALIFICATION" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const, position: undefined, timeBehindMs: undefined };

  it("bevarar tid och splits men förbjuder ranking", () => {
    expect(publicResultListResponseSchema.parse({ formatVersion: 7, results: [disqualified] }).results[0]).toEqual(disqualified);
    expect(accepts({ ...disqualified, position: 1, timeBehindMs: 0 })).toBe(false);
  });
});

describe("publikt DNF", () => {
  const dnf = { ...ranked, status: "DNF" as const, reason: "DID_NOT_FINISH" as const, elapsedMs: undefined, splits: [],
    rankingState: "NOT_RANKABLE_STATUS" as const, position: undefined, timeBehindMs: undefined };

  it("visar DNF status-only utan intern provenance", () => {
    const parsed = publicResultListResponseSchema.parse({ formatVersion: 7, results: [dnf] });
    expect(parsed.results[0]).toEqual(dnf);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|readoutId/i);
  });

  it("avvisar DNF med tid eller placering", () => {
    expect(accepts({ ...dnf, elapsedMs: 1 })).toBe(false);
    // Steg 38: brutit med avläsning har sträcktider fram till sista stämplade kontrollen, men aldrig tid eller placering.
    expect(accepts({ ...dnf, splits: ranked.splits })).toBe(true);
    expect(accepts({ ...dnf, splits: ranked.splits, position: 1, timeBehindMs: 0 })).toBe(false);
  });
});

describe("publikt OOC", () => {
  const outOfCompetition = { ...ranked, status: "OOC" as const, reason: "OUT_OF_COMPETITION" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const, position: undefined, timeBehindMs: undefined,
    missingControls: [45], extraPunches: [99] };

  it("visar bevarad teknisk fakta utan ranking eller intern proveniens", () => {
    const parsed = publicResultListResponseSchema.parse({ formatVersion: 7, results: [outOfCompetition] });
    expect(parsed.results[0]).toEqual(outOfCompetition);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|readoutId/i);
  });

  it("avvisar ranking eller OOC-reason på MP", () => {
    expect(accepts({ ...outOfCompetition, position: 1, timeBehindMs: 0 })).toBe(false);
    expect(accepts({ ...outOfCompetition, status: "MP" })).toBe(false);
  });
});

describe("publikt NT", () => {
  const withoutTiming = { className: "H21", givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK",
    publicResultId, revision: 4, status: "NT" as const, reason: "WITHOUT_TIMING" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const };

  it("visar endast den distinkta statusen utan tekniska fakta", () => {
    expect(publicResultListResponseSchema.parse({ formatVersion: 7, results: [withoutTiming] }).results[0])
      .toEqual(withoutTiming);
  });

  it.each([{ elapsedMs: 1 }, { missingControls: [] }, { extraPunches: [] }, { position: 1 }])(
    "avvisar NT med teknisk fakta eller ranking", (mutation) => {
      expect(accepts({ ...withoutTiming, ...mutation })).toBe(false);
    });
});

describe("TASK089 publik resultatidentitet", () => {
  it("kräver en opaque UUID på varje publik rad och återanvänder exakt raden i detaljsvaret", () => {
    const list = publicResultListResponseV7Schema.parse({ formatVersion: 7, results: [ranked] });
    const detail = publicResultDetailResponseSchema.parse({ formatVersion: 1, result: ranked });
    expect(detail.result).toEqual(list.results[0]);
    expect(JSON.stringify(detail)).not.toMatch(/entryId|classId|courseVersionId|readoutId|resultRevisionId|cardNumber/i);
  });

  it("avvisar saknad, ogiltig eller extra identitetsdata", () => {
    expect(accepts({ ...ranked, publicResultId: undefined })).toBe(false);
    expect(accepts({ ...ranked, publicResultId: "Ada" })).toBe(false);
    expect(publicResultDetailResponseSchema.safeParse({ formatVersion: 1, result: { ...ranked, entryId: publicResultId } }).success)
      .toBe(false);
  });
});
