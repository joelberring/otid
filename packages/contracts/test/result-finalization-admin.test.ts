import { describe, expect, it } from "vitest";
import {
  classResultFinalizationMetadataSchema,
  frozenResultFinalizationProjectionSchema,
  frozenRaceFinalizationListResponseSchema,
  raceResultFinalizationMetadataSchema,
  resultFinalizationAdminErrorResponseSchema,
  resultFinalizationAdminLoginRequestSchema,
  resultFinalizationAdminLoginResponseSchema,
  resultFinalizationCandidateResponseSchema,
  resultFinalizationIdempotencyKeySchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "b0000000-0000-4000-8000-000000000002";
const classId = "c0000000-0000-4000-8000-000000000003";
const classFinalizationId = "d0000000-0000-4000-8000-000000000004";
const raceFinalizationId = "e0000000-0000-4000-8000-000000000005";
const hash = "a".repeat(64);
const frozenHash = "b".repeat(64);
const xmlHash = "c".repeat(64);
const finalizedAt = "2026-08-31T18:00:00.000Z";

const classFinalization = {
  id: classFinalizationId,
  raceId,
  scope: "CLASS",
  classId,
  scopeRevision: 1,
  sourceSnapshotVersion: 7,
  basisHash: hash,
  frozenProjectionHash: frozenHash,
  entryCount: 2,
  classCount: 1,
  completeXmlSha256: null,
  finalizedAt
} as const;

const raceFinalization = {
  id: raceFinalizationId,
  raceId,
  scope: "RACE",
  classId: null,
  scopeRevision: 1,
  sourceSnapshotVersion: 7,
  basisHash: hash,
  frozenProjectionHash: frozenHash,
  entryCount: 2,
  classCount: 1,
  completeXmlSha256: xmlHash,
  finalizedAt
} as const;

describe("TASK 006D resultatfinaliseringskontrakt", () => {
  it("separerar FINALIZE_RESULTS med canonical credential och svar", () => {
    const accessCredential = `otid_org_result_finalize_v1.${requestId}.${"A".repeat(43)}`;
    expect(resultFinalizationAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential }))
      .toEqual({ formatVersion: 1, accessCredential });
    expect(resultFinalizationAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: accessCredential.replace("result_finalize", "result_recalc")
    }).success).toBe(false);
    expect(resultFinalizationAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "FINALIZE_RESULTS",
      expiresAt: finalizedAt
    }).capability).toBe("FINALIZE_RESULTS");
  });

  it("lämnar bara klassnamn, räknare, blockerare, hash och immutable metadata i kandidaten", () => {
    const response = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      race: {
        entryCount: 2,
        nonEmptyClassCount: 1,
        unresolvedUnknownCardReadoutCount: 0,
        blockerCodes: [],
        basisHash: hash,
        latestFinalization: null
      },
      classes: [{
        classId,
        className: "D21",
        entryCount: 2,
        blockerCodes: [],
        basisHash: hash,
        latestFinalization: classFinalization
      }]
    } as const;
    expect(resultFinalizationCandidateResponseSchema.parse(response)).toEqual(response);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      ...response,
      classes: [{ ...response.classes[0], givenName: "Ada" }]
    }).success).toBe(false);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      ...response,
      race: { ...response.race, entryCount: 1 }
    }).success).toBe(false);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      ...response,
      classes: [{ ...response.classes[0], blockerCodes: ["UNKNOWN_CARD_UNRESOLVED"] }]
    }).success).toBe(false);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      ...response,
      classes: [{ ...response.classes[0], blockerCodes: ["WITHDRAWN_DID_NOT_START"] }]
    }).success).toBe(true);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      ...response,
      race: { ...response.race, blockerCodes: ["WITHDRAWN_DID_NOT_START"] }
    }).success).toBe(false);
  });

  it("kräver konsekventa scope/null-fält och lyckad Complete-metadata", () => {
    expect(classResultFinalizationMetadataSchema.parse(classFinalization)).toEqual(classFinalization);
    expect(raceResultFinalizationMetadataSchema.parse(raceFinalization)).toEqual(raceFinalization);
    expect(classResultFinalizationMetadataSchema.safeParse({
      ...classFinalization,
      completeXmlSha256: xmlHash
    }).success).toBe(false);
    expect(raceResultFinalizationMetadataSchema.safeParse({ ...raceFinalization, classId }).success).toBe(false);
    expect(raceResultFinalizationMetadataSchema.safeParse({ ...raceFinalization, entryCount: 0 }).success).toBe(false);
  });

  it("tillåter en fryst DNS endast som status-only-resultat", () => {
    const projection = {
      formatVersion: 1,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source: { entryId: requestId, resultRevisionId: raceFinalizationId, revision: 1, courseVersionId: classId },
          personResult: {
            entryExternalId: null,
            givenName: "Ada",
            familyName: "Löpare",
            organisationName: null,
            status: "DNS",
            startTime: null,
            finishTime: null,
            elapsedMs: null,
            position: null,
            timeBehindMs: null,
            expectedControls: [],
            splits: []
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.safeParse(projection).success).toBe(true);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: { ...projection.class, results: [{
        ...projection.class.results[0],
        personResult: { ...projection.class.results[0].personResult, elapsedMs: 1 }
      }] }
    }).success).toBe(false);
  });

  it("fryser CLASS/RACE-intent och canonical idempotensnyckel", () => {
    const classRequest = {
      formatVersion: 1,
      scope: "CLASS",
      classId,
      expectedSnapshotVersion: 7,
      expectedBasisHash: hash,
      expectedLatestScopeRevision: 1
    } as const;
    const raceRequest = {
      formatVersion: 1,
      scope: "RACE",
      classId: null,
      expectedSnapshotVersion: 7,
      expectedBasisHash: hash,
      expectedLatestScopeRevision: null
    } as const;
    expect(resultFinalizationRequestSchema.parse(classRequest)).toEqual(classRequest);
    expect(resultFinalizationRequestSchema.parse(raceRequest)).toEqual(raceRequest);
    expect(resultFinalizationRequestSchema.safeParse({ ...classRequest, classId: null }).success).toBe(false);
    expect(resultFinalizationRequestSchema.safeParse({ ...raceRequest, classId }).success).toBe(false);
    expect(resultFinalizationRequestSchema.safeParse({ ...raceRequest, expectedLatestScopeRevision: 0 }).success).toBe(false);
    expect(resultFinalizationIdempotencyKeySchema.parse(`result-finalization:${requestId}`))
      .toBe(`result-finalization:${requestId}`);
    expect(resultFinalizationIdempotencyKeySchema.safeParse(
      `result-finalization:${requestId.toUpperCase()}`
    ).success).toBe(false);
  });

  it("exponerar immutable svar och endast frysta RACE-finaliseringar för export", () => {
    expect(resultFinalizationResponseSchema.parse({
      formatVersion: 1,
      replayed: false,
      requestId,
      finalization: classFinalization
    }).finalization).toEqual(classFinalization);
    expect(resultFinalizationResponseSchema.parse({
      formatVersion: 1,
      replayed: true,
      requestId,
      finalization: raceFinalization
    }).finalization).toEqual(raceFinalization);
    expect(frozenRaceFinalizationListResponseSchema.parse({
      formatVersion: 1,
      raceId,
      finalizations: [raceFinalization]
    }).finalizations).toEqual([raceFinalization]);
    expect(frozenRaceFinalizationListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      finalizations: [classFinalization]
    }).success).toBe(false);
    expect(frozenRaceFinalizationListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      finalizations: [{ ...raceFinalization, frozenProjection: {} }]
    }).success).toBe(false);
  });

  it("validerar en privat fryst CLASS/RACE-projektion separat från HTTP-DTO:er", () => {
    const personResult = {
      entryExternalId: null,
      givenName: "Ada",
      familyName: "Löpare",
      organisationName: "Centrum OK",
      status: "OK",
      startTime: "2026-08-31T10:00:00.000Z",
      finishTime: "2026-08-31T10:20:00.000Z",
      elapsedMs: 1_200_000,
      position: 1,
      timeBehindMs: 0,
      expectedControls: [{ controlCode: 31, occurrence: 1 }],
      splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }]
    } as const;
    const frozenClass = {
      formatVersion: 1,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source: {
            entryId: "f0000000-0000-4000-8000-000000000006",
            resultRevisionId: "a0000000-0000-4000-8000-000000000007",
            revision: 2,
            courseVersionId: "b0000000-0000-4000-8000-000000000008"
          },
          personResult
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(frozenClass)).toEqual(frozenClass);
    expect(frozenResultFinalizationProjectionSchema.parse({
      formatVersion: 1,
      scope: "RACE",
      raceId,
      snapshotVersion: 7,
      basisSha256: hash,
      eventName: "Nattcupen",
      classes: [{
        classFinalizationId,
        classFinalizationRevision: 1,
        classBasisSha256: hash,
        classId,
        class: frozenClass.class
      }]
    }).scope).toBe("RACE");
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...frozenClass,
      class: { ...frozenClass.class, results: [{ ...frozenClass.class.results[0], personResult: {
        ...personResult,
        status: "MP",
        position: 1,
        timeBehindMs: 0
      } }] }
    }).success).toBe(false);
    expect(resultFinalizationCandidateResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      race: { entryCount: 1, nonEmptyClassCount: 1, unresolvedUnknownCardReadoutCount: 0, blockerCodes: [], basisHash: hash, latestFinalization: null },
      classes: [{ classId, className: "D21", entryCount: 1, blockerCodes: [], basisHash: hash, latestFinalization: null, frozenProjection: frozenClass }]
    }).success).toBe(false);
  });

  it("läser ny format 2-projektion med DSQ och fryst livscykelproveniens", () => {
    const targetResultRevisionId = "f0000000-0000-4000-8000-000000000006";
    const resultRevisionId = "a0000000-0000-4000-8000-000000000007";
    const decisionId = "b0000000-0000-4000-8000-000000000008";
    const projection = {
      formatVersion: 2,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source: {
            kind: "MANUAL_DISQUALIFICATION",
            entryId: requestId,
            resultRevisionId,
            revision: 4,
            courseVersionId: classId,
            resultDisqualificationDecisionId: decisionId,
            targetResultRevisionId,
            absoluteResultRevisionId: resultRevisionId,
            absoluteResultRevision: 4
          },
          personResult: {
            entryExternalId: null,
            givenName: "Ada",
            familyName: "Löpare",
            organisationName: null,
            status: "DSQ",
            startTime: "2026-08-31T10:00:00.000Z",
            finishTime: "2026-08-31T10:20:00.000Z",
            elapsedMs: 1_200_000,
            position: null,
            timeBehindMs: null,
            expectedControls: [{ controlCode: 31, occurrence: 1 }],
            splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }]
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(projection)).toEqual(projection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({ ...projection, formatVersion: 1 }).success)
      .toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: {
        ...projection.class,
        results: [{
          ...projection.class.results[0],
          source: { ...projection.class.results[0].source, kind: "READOUT_RESULT", readoutId: requestId }
        }]
      }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: {
        ...projection.class,
        results: [{
          ...projection.class.results[0],
          personResult: { ...projection.class.results[0].personResult, position: 1, timeBehindMs: 0 }
        }]
      }
    }).success).toBe(false);
  });

  it("läser format 3 med matchande approval-proof och tillåter fryst saknad split", () => {
    const targetResultRevisionId = "f0000000-0000-4000-8000-000000000006";
    const resultRevisionId = "a0000000-0000-4000-8000-000000000007";
    const decisionId = "b0000000-0000-4000-8000-000000000008";
    const projection = {
      formatVersion: 3,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source: {
            kind: "MANUAL_RESULT_APPROVAL",
            entryId: requestId,
            resultRevisionId,
            revision: 4,
            courseVersionId: classId,
            resultApprovalDecisionId: decisionId,
            targetResultRevisionId,
            approvedResultRevisionId: resultRevisionId,
            absoluteResultRevisionId: resultRevisionId,
            absoluteResultRevision: 4
          },
          personResult: {
            entryExternalId: null,
            givenName: "Ada",
            familyName: "Löpare",
            organisationName: null,
            status: "OK",
            startTime: "2026-08-31T10:00:00.000Z",
            finishTime: "2026-08-31T10:20:00.000Z",
            elapsedMs: 1_200_000,
            position: 1,
            timeBehindMs: 0,
            expectedControls: [
              { controlCode: 31, occurrence: 1 },
              { controlCode: 45, occurrence: 1 }
            ],
            splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }],
            manualApprovalProof: { decisionId, targetResultRevisionId }
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(projection)).toEqual(projection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({ ...projection, formatVersion: 2 }).success)
      .toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: { ...projection.class, results: [{
        ...projection.class.results[0],
        personResult: { ...projection.class.results[0].personResult, manualApprovalProof: null }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: { ...projection.class, results: [{
        ...projection.class.results[0],
        personResult: {
          ...projection.class.results[0].personResult,
          manualApprovalProof: { decisionId: requestId, targetResultRevisionId }
        }
      }] }
    }).success).toBe(false);
  });

  it("läser format 4 med DNF, exakt decision/target och absolut underliggande head", () => {
    const targetResultRevisionId = "f0000000-0000-4000-8000-000000000006";
    const resultRevisionId = "a0000000-0000-4000-8000-000000000007";
    const decisionId = "b0000000-0000-4000-8000-000000000008";
    const absoluteResultRevisionId = "c0000000-0000-4000-8000-000000000009";
    const projection = {
      formatVersion: 4,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source: {
            kind: "MANUAL_DID_NOT_FINISH",
            entryId: requestId,
            resultRevisionId,
            revision: 4,
            courseVersionId: classId,
            didNotFinishDecisionId: decisionId,
            targetResultRevisionId,
            absoluteResultRevisionId,
            absoluteResultRevision: 5
          },
          personResult: {
            entryExternalId: null,
            givenName: "Ada",
            familyName: "Löpare",
            organisationName: null,
            status: "DNF",
            startTime: null,
            finishTime: null,
            elapsedMs: null,
            position: null,
            timeBehindMs: null,
            expectedControls: [],
            splits: [],
            manualApprovalProof: null
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(projection)).toEqual(projection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({ ...projection, formatVersion: 3 }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: { ...projection.class, results: [{
        ...projection.class.results[0],
        personResult: { ...projection.class.results[0].personResult, elapsedMs: 1 }
      }] }
    }).success).toBe(false);
  });

  it("läser CLASS och RACE format 5 med DNF-withdrawal och restaurerat utfall", () => {
    const targetResultRevisionId = "f0000000-0000-4000-8000-000000000006";
    const didNotFinishResultRevisionId = "a0000000-0000-4000-8000-000000000007";
    const restorationSourceResultRevisionId = "b0000000-0000-4000-8000-000000000008";
    const resultRevisionId = "c0000000-0000-4000-8000-000000000009";
    const didNotFinishDecisionId = "d0000000-0000-4000-8000-00000000000a";
    const didNotFinishWithdrawalId = "e0000000-0000-4000-8000-00000000000b";
    const frozenClass = {
      name: "D21",
      externalId: null,
      results: [{
        source: {
          kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
          entryId: requestId,
          resultRevisionId,
          revision: 6,
          courseVersionId: classId,
          didNotFinishWithdrawalId,
          didNotFinishDecisionId,
          targetResultRevisionId,
          didNotFinishResultRevisionId,
          restorationSourceResultRevisionId
        },
        personResult: {
          entryExternalId: null,
          givenName: "Ada",
          familyName: "Löpare",
          organisationName: null,
          status: "OK",
          startTime: "2026-08-31T10:00:00.000Z",
          finishTime: "2026-08-31T10:20:00.000Z",
          elapsedMs: 1_200_000,
          position: 1,
          timeBehindMs: 0,
          expectedControls: [{ controlCode: 31, occurrence: 1 }],
          splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }],
          manualApprovalProof: null
        }
      }]
    } as const;
    const classProjection = {
      formatVersion: 5,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: frozenClass
    } as const;
    const raceProjection = {
      formatVersion: 5,
      scope: "RACE",
      raceId,
      snapshotVersion: 7,
      basisSha256: hash,
      eventName: "O-Tid",
      classes: [{
        classFinalizationId,
        classFinalizationRevision: 2,
        classBasisSha256: hash,
        classId,
        class: frozenClass
      }]
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(classProjection)).toEqual(classProjection);
    expect(frozenResultFinalizationProjectionSchema.parse(raceProjection)).toEqual(raceProjection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({ ...classProjection, formatVersion: 4 }).success)
      .toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: { ...frozenClass.results[0].personResult, status: "DNF" }
      }] }
    }).success).toBe(false);
  });

  it("läser CLASS och RACE format 6 med fryst permanent OOC-overlay", () => {
    const targetResultRevisionId = "f0000000-0000-4000-8000-000000000006";
    const resultRevisionId = "a0000000-0000-4000-8000-000000000007";
    const notCompetingDecisionId = "b0000000-0000-4000-8000-000000000008";
    const absoluteResultRevisionId = "c0000000-0000-4000-8000-000000000009";
    const frozenClass = {
      name: "D21",
      externalId: null,
      results: [{
        source: {
          kind: "MANUAL_OUT_OF_COMPETITION",
          entryId: requestId,
          resultRevisionId,
          revision: 4,
          courseVersionId: classId,
          notCompetingDecisionId,
          targetResultRevisionId,
          absoluteResultRevisionId,
          absoluteResultRevision: 5
        },
        personResult: {
          entryExternalId: null,
          givenName: "Ada",
          familyName: "Löpare",
          organisationName: null,
          status: "OOC",
          startTime: "2026-08-31T10:00:00.000Z",
          finishTime: "2026-08-31T10:20:00.000Z",
          elapsedMs: 1_200_000,
          position: null,
          timeBehindMs: null,
          expectedControls: [
            { controlCode: 31, occurrence: 1 },
            { controlCode: 45, occurrence: 1 }
          ],
          splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }],
          manualApprovalProof: null
        }
      }]
    } as const;
    const classProjection = {
      formatVersion: 6,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: frozenClass
    } as const;
    const raceProjection = {
      formatVersion: 6,
      scope: "RACE",
      raceId,
      snapshotVersion: 7,
      basisSha256: hash,
      eventName: "O-Tid",
      classes: [{
        classFinalizationId,
        classFinalizationRevision: 2,
        classBasisSha256: hash,
        classId,
        class: frozenClass
      }]
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(classProjection)).toEqual(classProjection);
    expect(frozenResultFinalizationProjectionSchema.parse(raceProjection)).toEqual(raceProjection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({ ...classProjection, formatVersion: 5 }).success)
      .toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: { ...frozenClass.results[0].personResult, position: 1, timeBehindMs: 0 }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: {
          ...frozenClass.results[0].personResult,
          manualApprovalProof: { decisionId: notCompetingDecisionId, targetResultRevisionId }
        }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        source: { ...frozenClass.results[0].source, kind: "READOUT_RESULT", readoutId: requestId }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: { ...frozenClass.results[0].personResult, startTime: null }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: { ...frozenClass.results[0].personResult, elapsedMs: null }
      }] }
    }).success).toBe(false);
  });

  it("läser format 7 med fryst OOC-withdrawal och återställt OK", () => {
    const source = {
      kind: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
      entryId: requestId,
      resultRevisionId: "a0000000-0000-4000-8000-000000000007",
      revision: 5,
      courseVersionId: classId,
      notCompetingWithdrawalId: "b0000000-0000-4000-8000-000000000008",
      notCompetingDecisionId: "c0000000-0000-4000-8000-000000000009",
      targetResultRevisionId: "d0000000-0000-4000-8000-000000000010",
      outOfCompetitionResultRevisionId: "e0000000-0000-4000-8000-000000000011",
      absoluteResultRevisionId: "e0000000-0000-4000-8000-000000000011",
      absoluteResultRevision: 4,
      restorationSourceResultRevisionId: "d0000000-0000-4000-8000-000000000010"
    } as const;
    const projection = {
      formatVersion: 7,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21",
        externalId: null,
        results: [{
          source,
          personResult: {
            entryExternalId: null,
            givenName: "Ada",
            familyName: "Löpare",
            organisationName: null,
            status: "OK",
            startTime: "2026-08-31T10:00:00.000Z",
            finishTime: "2026-08-31T10:20:00.000Z",
            elapsedMs: 1_200_000,
            position: 1,
            timeBehindMs: 0,
            expectedControls: [{ controlCode: 31, occurrence: 1 }],
            splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }],
            manualApprovalProof: null
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(projection)).toEqual(projection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection,
      class: { ...projection.class, results: [{
        ...projection.class.results[0],
        personResult: { ...projection.class.results[0].personResult, status: "OOC", position: null, timeBehindMs: null }
      }] }
    }).success).toBe(false);
  });

  it("läser format 8 med fryst NT-withdrawal och återställt MP", () => {
    const source = {
      kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
      entryId: requestId,
      resultRevisionId: "a0000000-0000-4000-8000-000000000007",
      revision: 5,
      courseVersionId: classId,
      withoutTimingWithdrawalId: "b0000000-0000-4000-8000-000000000008",
      withoutTimingDecisionId: "c0000000-0000-4000-8000-000000000009",
      targetResultRevisionId: "d0000000-0000-4000-8000-000000000010",
      withoutTimingResultRevisionId: "e0000000-0000-4000-8000-000000000011",
      absoluteResultRevisionId: "e0000000-0000-4000-8000-000000000011",
      absoluteResultRevision: 4,
      restorationSourceResultRevisionId: "d0000000-0000-4000-8000-000000000010"
    } as const;
    const projection = {
      formatVersion: 8,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: {
        name: "D21", externalId: null, results: [{
          source,
          personResult: {
            entryExternalId: null, givenName: "Ada", familyName: "Löpare", organisationName: null,
            status: "MP", startTime: "2026-08-31T10:00:00.000Z", finishTime: "2026-08-31T10:20:00.000Z",
            elapsedMs: 1_200_000, position: null, timeBehindMs: null,
            expectedControls: [{ controlCode: 31, occurrence: 1 }],
            splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000 }], manualApprovalProof: null
          }
        }]
      }
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(projection)).toEqual(projection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...projection, class: { ...projection.class, results: [{
        ...projection.class.results[0], personResult: { ...projection.class.results[0].personResult, status: "NT" }
      }] }
    }).success).toBe(false);
  });

  it("läser format 9 med strikt aktiv startavpricknings-DNS-proveniens", () => {
    const source = {
      kind: "START_CHECKIN_DID_NOT_START",
      entryId: requestId,
      resultRevisionId: "a0000000-0000-4000-8000-000000000007",
      revision: 5,
      courseVersionId: classId,
      startCheckinDnsDecisionId: "b0000000-0000-4000-8000-000000000008",
      operationRequestId: "c0000000-0000-4000-8000-000000000009",
      startCheckinRevisionId: "d0000000-0000-4000-8000-000000000010",
      operationalRevision: 4,
      withdrawal: null
    } as const;
    const frozenClass = {
      name: "D21",
      externalId: null,
      results: [{
        source,
        personResult: {
          entryExternalId: null,
          givenName: "Ada",
          familyName: "Löpare",
          organisationName: null,
          status: "DNS",
          startTime: null,
          finishTime: null,
          elapsedMs: null,
          position: null,
          timeBehindMs: null,
          expectedControls: [],
          splits: [],
          manualApprovalProof: null
        }
      }]
    } as const;
    const classProjection = {
      formatVersion: 9,
      scope: "CLASS",
      raceId,
      classId,
      snapshotVersion: 7,
      basisSha256: hash,
      class: frozenClass
    } as const;
    const raceProjection = {
      formatVersion: 9,
      scope: "RACE",
      raceId,
      snapshotVersion: 7,
      basisSha256: hash,
      eventName: "O-Tid",
      classes: [{
        classFinalizationId,
        classFinalizationRevision: 3,
        classBasisSha256: hash,
        classId,
        class: frozenClass
      }]
    } as const;
    expect(frozenResultFinalizationProjectionSchema.parse(classProjection)).toEqual(classProjection);
    expect(frozenResultFinalizationProjectionSchema.parse(raceProjection)).toEqual(raceProjection);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        source: { ...source, withdrawal: requestId }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: { ...frozenClass.results[0].personResult, status: "OK" }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{
        ...frozenClass.results[0],
        personResult: {
          ...frozenClass.results[0].personResult,
          manualApprovalProof: { decisionId: requestId, targetResultRevisionId: source.resultRevisionId }
        }
      }] }
    }).success).toBe(false);
    expect(frozenResultFinalizationProjectionSchema.safeParse({
      ...classProjection,
      class: { ...frozenClass, results: [{ personResult: frozenClass.results[0].personResult }] }
    }).success).toBe(false);
  });

  it("håller finaliseringsfel detaljfria", () => {
    for (const error of [
      "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "TOO_LARGE", "INTERNAL_ERROR"
    ]) {
      expect(resultFinalizationAdminErrorResponseSchema.parse({ formatVersion: 1, error }))
        .toEqual({ formatVersion: 1, error });
    }
    expect(resultFinalizationAdminErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "CONFLICT",
      details: "Samtidig ändring"
    }).success).toBe(false);
  });
});
