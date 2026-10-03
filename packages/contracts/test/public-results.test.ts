import { describe, expect, it } from "vitest";
import {
  publicResultListResponseSchema,
  publicResultListResponseV1Schema,
  publicResultListResponseV2Schema,
  publicResultListResponseV3Schema,
  publicResultListResponseV4Schema,
  publicResultListResponseV5Schema,
  publicResultListResponseV6Schema,
  publicResultListResponseV7Schema,
  publicResultDetailResponseSchema,
  publicResultSchema
} from "../src";

const ranked = {
  className: "H21",
  givenName: "Ada",
  familyName: "Löpare",
  organisationName: "Centrum OK",
  revision: 2,
  status: "OK" as const,
  reason: "COMPLETE" as const,
  elapsedMs: 3_600_123,
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_001, legMs: 600_001 }],
  rankingState: "RANKED" as const,
  position: 1,
  timeBehindMs: 0
};

describe("publicResultListResponseSchema", () => {
  it("accepterar en minimal strikt publik ranking utan interna id:n", () => {
    const parsed = publicResultListResponseSchema.parse({ formatVersion: 1, results: [ranked] });
    expect(parsed.results[0]).toEqual(ranked);
    expect(JSON.stringify(parsed)).not.toMatch(/entryId|classId|courseVersionId|readoutId|resultRevisionId/);
  });

  it.each([
    ["halvt rankingpar", { ...ranked, timeBehindMs: undefined }],
    ["ranking på MP", { ...ranked, status: "MP", reason: "MISSING_CONTROL" }],
    ["blandad bana med position", { ...ranked, rankingState: "MIXED_COURSE_VERSIONS" }],
    ["tid efter större än totaltid", { ...ranked, timeBehindMs: ranked.elapsedMs + 1 }],
    ["okänt fält", { ...ranked, entryId: "11111111-1111-4111-8111-111111111111" }]
  ])("avvisar %s", (_name, result) => {
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 1, results: [result] }).success).toBe(false);
  });

  it("accepterar MP och mixed-course OK endast utan rankingfält", () => {
    expect(publicResultListResponseSchema.safeParse({
      formatVersion: 1,
      results: [
        {
          ...ranked,
          status: "MP",
          reason: "MISSING_CONTROL",
          rankingState: "NOT_RANKABLE_STATUS",
          position: undefined,
          timeBehindMs: undefined
        },
        {
          ...ranked,
          rankingState: "MIXED_COURSE_VERSIONS",
          position: undefined,
          timeBehindMs: undefined
        }
      ]
    }).success).toBe(true);
  });

  it("accepterar DNS endast som publik status-only-rad", () => {
    const dns = {
      ...ranked,
      status: "DNS" as const,
      reason: "DID_NOT_START" as const,
      elapsedMs: undefined,
      splits: [],
      rankingState: "NOT_RANKABLE_STATUS" as const,
      position: undefined,
      timeBehindMs: undefined
    };
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 1, results: [dns] }).success).toBe(true);
    expect(publicResultListResponseSchema.safeParse({
      formatVersion: 1, results: [{ ...dns, elapsedMs: 1 }]
    }).success).toBe(false);
    expect(publicResultListResponseSchema.safeParse({
      formatVersion: 1, results: [{ ...dns, splits: ranked.splits }]
    }).success).toBe(false);
  });
});

describe("publikt manuellt godkännande format 3", () => {
  const approved = {
    ...ranked,
    reason: "MANUAL_APPROVAL" as const,
    missingControls: [45],
    extraPunches: [99]
  };

  it("rankar ett tidsatt godkänt resultat utan intern decisionproveniens", () => {
    const parsed = publicResultListResponseV3Schema.parse({ formatVersion: 3, results: [approved] });
    expect(parsed.results[0]).toEqual(approved);
    expect(parsed.results[0]!.missingControls).toEqual([45]);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|approvalProof/);
  });

  it("håller format 1 och 2 frysta och förbjuder approval-reason för MP", () => {
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 1, results: [approved] }).success).toBe(false);
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 2, results: [approved] }).success).toBe(false);
    expect(publicResultListResponseSchema.safeParse({
      formatVersion: 3,
      results: [{ ...approved, status: "MP", rankingState: "NOT_RANKABLE_STATUS", position: undefined, timeBehindMs: undefined }]
    }).success).toBe(false);
  });
});

describe("publik DSQ format 2", () => {
  const disqualified = {
    ...ranked,
    status: "DSQ" as const,
    reason: "MANUAL_DISQUALIFICATION" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const,
    position: undefined,
    timeBehindMs: undefined
  };

  it("bevarar tid och splits men förbjuder ranking", () => {
    expect(publicResultListResponseV2Schema.parse({
      formatVersion: 2,
      results: [disqualified]
    }).results[0]).toEqual(disqualified);
    expect(publicResultSchema.safeParse({ ...disqualified, position: 1, timeBehindMs: 0 }).success)
      .toBe(false);
  });

  it("håller v1 läsbart men förbjuder DSQ i format 1", () => {
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 1, results: [ranked] }).success)
      .toBe(true);
    expect(publicResultListResponseV1Schema.safeParse({ formatVersion: 1, results: [disqualified] }).success)
      .toBe(false);
  });
});

describe("publikt DNF format 4", () => {
  const dnf = {
    ...ranked,
    status: "DNF" as const,
    reason: "DID_NOT_FINISH" as const,
    elapsedMs: undefined,
    splits: [],
    rankingState: "NOT_RANKABLE_STATUS" as const,
    position: undefined,
    timeBehindMs: undefined,
    missingControls: [],
    extraPunches: []
  };

  it("visar DNF status-only utan intern provenance", () => {
    const parsed = publicResultListResponseV4Schema.parse({ formatVersion: 4, results: [dnf] });
    expect(parsed.results[0]).toEqual(dnf);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|readoutId/i);
  });

  it("håller format 1-3 frysta och avvisar DNF-fakta", () => {
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 3, results: [dnf] }).success).toBe(false);
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 4, results: [{ ...dnf, elapsedMs: 1 }] }).success).toBe(false);
    expect(publicResultListResponseSchema.safeParse({ formatVersion: 4, results: [{ ...dnf, splits: ranked.splits }] }).success).toBe(false);
  });
});

describe("publikt OOC format 5", () => {
  const outOfCompetition = {
    ...ranked,
    status: "OOC" as const,
    reason: "OUT_OF_COMPETITION" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const,
    position: undefined,
    timeBehindMs: undefined,
    missingControls: [45],
    extraPunches: [99]
  };

  it("visar bevarad teknisk fakta utan ranking eller intern proveniens", () => {
    const parsed = publicResultListResponseV5Schema.parse({ formatVersion: 5, results: [outOfCompetition] });
    expect(parsed.results[0]).toEqual(outOfCompetition);
    expect(JSON.stringify(parsed)).not.toMatch(/decisionId|targetResultRevisionId|readoutId/i);
  });

  it("håller format 1-4 frysta och avvisar ranking eller OOC-reason på MP", () => {
    for (const formatVersion of [1, 2, 3, 4] as const) {
      expect(publicResultListResponseSchema.safeParse({ formatVersion, results: [outOfCompetition] }).success)
        .toBe(false);
    }
    expect(publicResultListResponseV5Schema.safeParse({
      formatVersion: 5,
      results: [{ ...outOfCompetition, position: 1, timeBehindMs: 0 }]
    }).success).toBe(false);
    expect(publicResultListResponseV5Schema.safeParse({
      formatVersion: 5,
      results: [{ ...outOfCompetition, status: "MP" }]
    }).success).toBe(false);
  });
});

describe("publikt NT format 6", () => {
  const withoutTiming = {
    className: "H21",
    givenName: "Ada",
    familyName: "Löpare",
    organisationName: "Centrum OK",
    revision: 4,
    status: "NT" as const,
    reason: "WITHOUT_TIMING" as const,
    rankingState: "NOT_RANKABLE_STATUS" as const
  };

  it("visar endast den distinkta statusen utan tekniska fakta", () => {
    expect(publicResultListResponseV6Schema.parse({ formatVersion: 6, results: [withoutTiming] }).results[0])
      .toEqual(withoutTiming);
    for (const formatVersion of [1, 2, 3, 4, 5] as const) {
      expect(publicResultListResponseSchema.safeParse({ formatVersion, results: [withoutTiming] }).success).toBe(false);
    }
  });

  it.each([{ elapsedMs: 1 }, { splits: [] }, { missingControls: [] }, { extraPunches: [] }, { position: 1 }])(
    "avvisar NT med teknisk fakta eller ranking", (mutation) => {
      expect(publicResultListResponseV6Schema.safeParse({ formatVersion: 6, results: [{ ...withoutTiming, ...mutation }] }).success)
        .toBe(false);
    });
});

describe("TASK089 publik resultatidentitet format 7", () => {
  const publicResultId = "8d9f3135-5888-4e0c-b31e-fc2a5d81d627";
  const publicRow = { ...ranked, publicResultId, missingControls: [], extraPunches: [] };

  it("kräver en opaque UUID på varje publik rad och återanvänder exakt raden i detaljsvaret", () => {
    const list = publicResultListResponseV7Schema.parse({ formatVersion: 7, results: [publicRow] });
    const detail = publicResultDetailResponseSchema.parse({ formatVersion: 1, result: publicRow });
    expect(detail.result).toEqual(list.results[0]);
    expect(JSON.stringify(detail)).not.toMatch(/entryId|classId|courseVersionId|readoutId|resultRevisionId|cardNumber/i);
  });

  it("avvisar saknad, ogiltig eller extra identitetsdata", () => {
    expect(publicResultListResponseV7Schema.safeParse({ formatVersion: 7, results: [{ ...publicRow, publicResultId: undefined }] }).success)
      .toBe(false);
    expect(publicResultListResponseV7Schema.safeParse({ formatVersion: 7, results: [{ ...publicRow, publicResultId: "Ada" }] }).success)
      .toBe(false);
    expect(publicResultDetailResponseSchema.safeParse({ formatVersion: 1, result: { ...publicRow, entryId: publicResultId } }).success)
      .toBe(false);
  });
});
