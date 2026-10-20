import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { exportIofResultListAsAdmin, getAdministratorEffectiveResult, ingestDeviceBatch, publicResults } from "../../src";
import { raceAuth } from "./accounts";
import { personResultBody, type Auth, statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();
const { classBlockers, decide, entryId, entryStatus, finalizeAll, revisions } = statusFlow(db);

/** Ada stämplar 31 och 33 men inte 32: tidsatt felstämpling. */
const missingControl = { ...okPayload, punches: [31, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 20}:00Z` })) };
const bo = { ...okPayload, cardNumber: "67890", startPunchedAt: "2026-08-30T10:01:00Z", finishPunchedAt: "2026-08-30T10:42:00Z",
  punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${11 + index * 10}:00Z` })) };

async function readOut(raceId: string, payload: typeof okPayload, finish?: string) {
  const ingested = await ingestDeviceBatch(db, raceId, batch(randomUUID(), finish ? { ...payload, finishPunchedAt: finish } : payload));
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
}

async function iofXml(auth: Auth) {
  const exported = await exportIofResultListAsAdmin(db, { sessionToken: auth.sessionToken, raceId: auth.raceId });
  if (exported.status !== "ok") throw new Error(`IOF-exporten misslyckades: ${exported.status}`);
  return new TextDecoder().decode(exported.bytes);
}

async function race(payload = missingControl) {
  const { raceId } = await importedRace();
  const auth = await raceAuth(db, raceId);
  await readOut(raceId, payload);
  return { raceId, auth, ada: await entryId(raceId, "Ada") };
}

describe("steg 23: beslut som ligger kvar över senare avläsningar (ADR-0173 beslut 1)", () => {
  it("brutit sparas en gång, ligger kvar över en ny avläsning och fryses som status-only", async () => {
    const { raceId, auth, ada } = await race();
    const requestId = randomUUID();
    const attempts = await Promise.all(Array.from({ length: 30 }, () =>
      decide(auth, ada, { kind: "DID_NOT_FINISH" }, { requestId, expectedRevision: 1 })));
    expect(attempts.every((attempt) => attempt.status === "decided")).toBe(true);
    const history = await revisions(ada);
    expect(history.map((row) => [row.revision, row.cause, row.status])).toEqual([[1, "CARD_READOUT", "MP"],
      [2, "MANUAL_DID_NOT_FINISH", "DNF"]]);
    expect(history[1]?.evaluation).toEqual({ status: "DNF", reason: "DID_NOT_FINISH", entryId: ada,
      classId: (history[0]!.evaluation as { classId: string }).classId, courseVersionId: history[0]!.courseVersionId });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "DID_NOT_FINISH_DECIDED" })]);

    await readOut(raceId, missingControl, "2026-08-30T10:41:00Z");
    const publicAda = (await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada");
    expect(publicAda).toMatchObject({ revision: 2, status: "DNF", splits: [], rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("elapsedMs");
    expect(await entryStatus(auth, ada)).toMatchObject({ headRevision: 3, governingDecision: "DNF",
      readiness: { APPROVE_MANUALLY: "ACTIVE_DID_NOT_FINISH", DISQUALIFIED: "ACTIVE_DID_NOT_FINISH", WITHDRAW: "READY" } });
    expect(await decide(auth, ada, { kind: "DISQUALIFIED" })).toMatchObject({ status: "conflict", readiness: "ACTIVE_DID_NOT_FINISH" });
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "DNF", result: { revision: 2, status: "DNF" }, selectedRevision: { revision: 3 } } });

    const snapshot = personResultBody(await iofXml(auth), "Ada");
    expect(snapshot).toContain("<Status>DidNotFinish</Status>");
    expect(snapshot).not.toMatch(/<(StartTime|FinishTime|Time|TimeBehind|Position|SplitTime)(?:\s|>)/);

    await readOut(raceId, bo);
    const finalizationId = await finalizeAll(auth);
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozen?.completeXml) throw new Error("Fryst Complete saknas");
    expect(JSON.stringify(frozen.frozenProjection)).toContain('"cause":"MANUAL_DID_NOT_FINISH"');
    expect(personResultBody(frozen.completeXml, "Ada")).toContain("<Status>DidNotFinish</Status>");
    await readOut(raceId, missingControl, "2026-08-30T10:43:00Z");
    const [after] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(after?.completeXml).toBe(frozen.completeXml);
    expect(after?.frozenProjection).toEqual(frozen.frozenProjection);
  }, 30_000);

  it("ta bort återställer den senaste avläsningen utan omräkning och kräver ny avläsning före nästa beslut", async () => {
    const { raceId, auth, ada } = await race();
    await decide(auth, ada, { kind: "DID_NOT_FINISH" });
    await readOut(raceId, missingControl, "2026-08-30T10:41:00Z");
    expect(await entryStatus(auth, ada)).toMatchObject({ withdrawRestores: { status: "MP" } });
    const requestId = randomUUID();
    const withdrawn = await decide(auth, ada, { kind: "WITHDRAW" }, { requestId });
    expect(withdrawn).toMatchObject({ status: "decided", response: { revision: 4, cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
      status: "MP", replayed: false } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" }, { requestId, expectedRevision: 3 }))
      .toMatchObject({ status: "decided", response: { revision: 4, replayed: true } });
    const history = await revisions(ada);
    expect(history[3]).toMatchObject({ cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL", readoutId: null, evaluation: history[2]!.evaluation });
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada")).toMatchObject({ revision: 4, status: "MP" });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "DID_NOT_FINISH_WITHDRAWN" })]);

    // Steg 31: nästa beslut kan fattas direkt på den återställda avläsningen (ingen återvändsgränd).
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "NONE", readiness: { DID_NOT_FINISH: "READY" } });
    await readOut(raceId, missingControl, "2026-08-30T10:42:00Z");
    expect((await entryStatus(auth, ada)).readiness.DID_NOT_FINISH).toBe("READY");
    expect(await decide(auth, ada, { kind: "DID_NOT_FINISH" })).toMatchObject({ status: "decided", response: { revision: 6 } });
  });

  it("ger en vinnare för två samtidiga återtaganden och ingen lucka mot en samtidig avläsning", async () => {
    const { raceId, auth, ada } = await race();
    await decide(auth, ada, { kind: "DID_NOT_FINISH" });
    const results = await Promise.all([decide(auth, ada, { kind: "WITHDRAW" }, { expectedRevision: 2 }),
      decide(auth, ada, { kind: "WITHDRAW" }, { expectedRevision: 2 })]);
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "decided"]);

    await decide(auth, ada, { kind: "DID_NOT_FINISH" }, { expectedRevision: 3 }).then((result) =>
      expect(result).toMatchObject({ status: "decided", response: { revision: 4 } }));
    const [withdrawn] = await Promise.all([decide(auth, ada, { kind: "WITHDRAW" }, { expectedRevision: 4 }),
      readOut(raceId, missingControl, "2026-08-30T10:44:00Z")]);
    const history = await revisions(ada);
    expect(history.map((row) => row.revision)).toEqual(history.map((_, index) => index + 1));
    if (withdrawn.status === "decided") expect(history.map((row) => row.cause)).toContain("MANUAL_DID_NOT_FINISH_WITHDRAWAL");
    else expect(withdrawn).toMatchObject({ status: "conflict", headRevision: 6 });
  });

  it("avvisar ett beslut mot ett äldre huvud utan revision eller audit", async () => {
    const { raceId, auth, ada } = await race();
    await readOut(raceId, missingControl, "2026-08-30T10:41:00Z");
    const requestId = randomUUID();
    expect(await decide(auth, ada, { kind: "DID_NOT_FINISH" }, { requestId, expectedRevision: 1 }))
      .toEqual({ status: "conflict", headRevision: 2, readiness: "STALE_RESULT" });
    expect(await revisions(ada)).toHaveLength(2);
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId))).toHaveLength(0);
  });

  it("utom tävlan behåller tiden utan placering, exporteras som NotCompeting och återtas till OK", async () => {
    const { raceId, auth, ada } = await race(okPayload);
    expect((await decide(auth, ada, { kind: "OUT_OF_COMPETITION" })).status).toBe("decided");
    const publicAda = (await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada");
    expect(publicAda).toMatchObject({ revision: 2, status: "OOC", elapsedMs: 2_400_000, rankingState: "NOT_RANKABLE_STATUS" });
    expect(personResultBody(await iofXml(auth), "Ada")).toContain("<Status>NotCompeting</Status>");
    await readOut(raceId, bo);
    const finalizationId = await finalizeAll(auth);
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(personResultBody(frozen!.completeXml!, "Ada")).toContain("<Status>NotCompeting</Status>");

    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", status: "OK" } });
    expect(personResultBody(await iofXml(auth), "Ada")).toContain("<Status>OK</Status>");
    expect(await classBlockers(auth)).toEqual([]);
  }, 30_000);

  it("utan tidtagning bara för ett komplett OK, blockerar IOF och fastställande tills det tas bort", async () => {
    const mp = await race();
    expect(await decide(mp.auth, mp.ada, { kind: "WITHOUT_TIMING" })).toMatchObject({ status: "conflict", readiness: "UNSUPPORTED_RESULT" });
    expect(await revisions(mp.ada)).toHaveLength(1);

    const { raceId, auth, ada } = await race(okPayload);
    expect((await decide(auth, ada, { kind: "WITHOUT_TIMING" })).status).toBe("decided");
    expect((await revisions(ada))[1]?.evaluation).not.toHaveProperty("elapsedMs");
    await readOut(raceId, okPayload, "2026-08-30T10:41:00Z");
    const publicAda = (await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada");
    expect(publicAda).toMatchObject({ revision: 2, status: "NT", reason: "WITHOUT_TIMING", rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("elapsedMs");
    expect(await entryStatus(auth, ada)).toMatchObject({ readiness: { OUT_OF_COMPETITION: "ACTIVE_WITHOUT_TIMING" } });
    expect(await exportIofResultListAsAdmin(db, { sessionToken: auth.sessionToken, raceId })).toEqual({ status: "conflict" });
    expect(await classBlockers(auth)).toContain("INVALID_RESULT_REVISION");

    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 4, cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL", status: "OK" } });
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada"))
      .toMatchObject({ status: "OK", rankingState: "RANKED", position: 1 });
    expect(personResultBody(await iofXml(auth), "Ada")).toContain("<Status>OK</Status>");
  }, 30_000);

  it("disk ligger kvar över en ny avläsning, fryses som Disqualified och de frysta bytesen ändras inte vid återtagande", async () => {
    const { raceId, auth, ada } = await race(okPayload);
    expect((await decide(auth, ada, { kind: "DISQUALIFIED" })).status).toBe("decided");
    await readOut(raceId, okPayload, "2026-08-30T10:30:00Z");
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada"))
      .toMatchObject({ revision: 2, status: "DSQ", rankingState: "NOT_RANKABLE_STATUS" });
    expect(personResultBody(await iofXml(auth), "Ada")).toContain("<Status>Disqualified</Status>");
    await readOut(raceId, bo);
    const finalizationId = await finalizeAll(auth);
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(JSON.stringify(frozen!.frozenProjection)).toContain('"cause":"MANUAL_DISQUALIFICATION"');

    const withdrawn = await decide(auth, ada, { kind: "WITHDRAW" });
    expect(withdrawn).toMatchObject({ status: "decided", response: { revision: 4, cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" } });
    const history = await revisions(ada);
    expect(history[3]?.evaluation).toEqual(history[2]?.evaluation);
    const [after] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(after?.completeXml).toBe(frozen?.completeXml);
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada"))
      .toMatchObject({ revision: 4, status: "OK", elapsedMs: 1_800_000 });
  }, 30_000);

  it("godkänner bara en tidsatt felstämpling, rankar den och återställer senaste tekniska huvud", async () => {
    const ok = await race(okPayload);
    expect(await decide(ok.auth, ok.ada, { kind: "APPROVE_MANUALLY" })).toMatchObject({ status: "conflict", readiness: "UNSUPPORTED_RESULT" });
    const untimed = await race({ ...missingControl, startPunchedAt: undefined as unknown as string });
    expect(await decide(untimed.auth, untimed.ada, { kind: "APPROVE_MANUALLY" })).toMatchObject({ status: "conflict" });

    const { raceId, auth, ada } = await race();
    expect(await decide(auth, ada, { kind: "APPROVE_MANUALLY" })).toMatchObject({ status: "decided",
      response: { revision: 2, cause: "MANUAL_RESULT_APPROVAL", status: "OK", reason: "MANUAL_APPROVAL" } });
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada"))
      .toMatchObject({ revision: 2, status: "OK", reason: "MANUAL_APPROVAL", missingControls: [32], rankingState: "RANKED", position: 1 });
    await readOut(raceId, okPayload, "2026-08-30T10:41:00Z");
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada")).toMatchObject({ revision: 2, reason: "MANUAL_APPROVAL" });
    expect(personResultBody(await iofXml(auth), "Ada")).toContain("<Status>OK</Status>");
    await readOut(raceId, bo);
    const finalizationId = await finalizeAll(auth);
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(JSON.stringify(frozen!.frozenProjection)).toContain('"cause":"MANUAL_RESULT_APPROVAL"');

    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 4, cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL", status: "OK", reason: "COMPLETE" } });
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "NONE", result: { revision: 4, status: "OK" },
        history: [{ revision: 4, cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" }, { revision: 3 }, { revision: 2 }, { revision: 1 }] } });
  }, 30_000);
});
