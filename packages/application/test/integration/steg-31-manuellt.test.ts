import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { getAdministratorEffectiveResult, ingestDeviceBatch, publicResults } from "../../src";
import { recalculateEntry } from "../../src/result-recalculation";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { contentHash } from "../../src/serialization";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

/** Steg 31 (B): manuell tid, brutit utan avläsning och godkända kontroller för en löpare; besluten ligger kvar. */
useRaceDatabase();
const { decide, entryId, entryStatus, revisions } = statusFlow(db);
/** En SPORTident-avläsning utan målstämpling ("glömde stämpla mål"). */
function noFinishBatch(deviceId: string) {
  const payload = { cardNumber: okPayload.cardNumber, cardType: "SI10" as const, startPunchedAt: okPayload.startPunchedAt,
    punches: okPayload.punches, untimedPunchCodes: [], frames: ["00"], simulated: false };
  return { deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
    stationReceivedAt: "2026-08-30T10:50:00Z", transport: "sportident" as const, payload, contentHash: contentHash(payload) }] };
}
const missing32 = { ...okPayload, punches: okPayload.punches.filter((punch) => punch.code !== 32) };

async function race() {
  const { raceId } = await importedRace();
  const auth = await raceAuth(db, raceId);
  return { raceId, auth, ada: await entryId(raceId, "Ada"), bo: await entryId(raceId, "Bo") };
}
const publicRow = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((row) => row.givenName === givenName);

describe("steg 31: ange tid manuellt", () => {
  it("rättar en saknad målstämpling, ligger kvar över samma avläsning igen och omräkning och kan tas bort", async () => {
    const { raceId, auth, ada } = await race();
    await ingestDeviceBatch(db, raceId, noFinishBatch(randomUUID()));
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "MP" });
    const status = await entryStatus(auth, ada);
    expect(status).toMatchObject({ readiness: { MANUAL_TIME: "READY", FINISH_TIME: "UNSUPPORTED_RESULT", APPROVE_MANUALLY: "UNSUPPORTED_RESULT" },
      manualTime: { knownStartTime: "2026-08-30T10:00:00.000Z", readoutFinishTime: null, hasReadout: true }, approvableControls: [] });

    const requestId = randomUUID();
    const decided = await decide(auth, ada, { kind: "MANUAL_TIME", finishTime: "2026-08-30T12:45:00+02:00", status: "OK",
      note: "Glömde stämpla mål" }, { requestId });
    expect(decided).toMatchObject({ status: "decided", response: { revision: 2, cause: "MANUAL_TIME", status: "OK" } });
    expect((await revisions(ada))[1]).toMatchObject({ readoutId: null, note: "Glömde stämpla mål",
      evaluation: { status: "OK", reason: "COMPLETE", elapsedMs: 2_700_000, splits: [{ controlCode: 31 }, { controlCode: 32 }, { controlCode: 33 }] } });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "MANUAL_TIME_DECIDED", actorKind: "USER_ACCOUNT" })]);
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_700_000 });
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: ada })).toMatchObject({ status: "ok",
      response: { state: "ACTIVE_RESULT", governingDecision: "MANUAL_TIME", decisionNote: "Glömde stämpla mål" } });

    // Samma bricka läses ut igen (annan dator) och omräkning: den manuella tiden ligger kvar.
    await ingestDeviceBatch(db, raceId, noFinishBatch(randomUUID()));
    await recalculateEntry(db, raceId, ada);
    expect((await revisions(ada)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_TIME", "CARD_READOUT",
      "CLASS_CHANGE_RECALCULATION"]);
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_700_000, revision: 2 });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "MANUAL_TIME", readiness: { WITHDRAW: "READY",
      MANUAL_TIME: "ACTIVE_MANUAL_TIME" } });

    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 5, cause: "MANUAL_TIME_WITHDRAWAL", status: "MP", reason: "MISSING_FINISH" } });
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "MP" });
  });

  it("fungerar utan avläsning (tappad bricka) och tas bort utan att lämna något resultat", async () => {
    const { raceId, auth, bo } = await race();
    expect(await entryStatus(auth, bo)).toMatchObject({ readiness: { MANUAL_TIME: "READY", DID_NOT_FINISH: "READY" },
      manualTime: { knownStartTime: null, hasReadout: false } });
    expect(await decide(auth, bo, { kind: "MANUAL_TIME", finishTime: "2026-08-30T10:50:00Z", status: "OK", note: "Tappade brickan" }))
      .toMatchObject({ status: "conflict", readiness: "INVALID_TIME" });
    expect(await decide(auth, bo, { kind: "MANUAL_TIME", startTime: "2026-08-30T10:02:00Z", finishTime: "2026-08-30T10:50:00Z",
      status: "OK", note: "Tappade brickan" })).toMatchObject({ status: "decided", response: { revision: 1, status: "OK" } });
    expect(await publicRow(raceId, "Bo")).toMatchObject({ status: "OK", elapsedMs: 2_880_000 });

    expect(await decide(auth, bo, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 2, cause: "MANUAL_RESULT_REMOVED" } });
    expect(await publicRow(raceId, "Bo")).toBeUndefined();
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: bo })).toMatchObject({ status: "ok",
      response: { state: "NO_ACTIVE_RESULT" } });

    // Brutit utan avläsning, och ej start går igen efter borttagningen.
    expect(await entryStatus(auth, bo)).toMatchObject({ readiness: { DID_NOT_START: "READY", DID_NOT_FINISH: "READY" } });
    expect(await decide(auth, bo, { kind: "DID_NOT_FINISH", note: "Bröt vid 2:an" })).toMatchObject({ status: "decided",
      response: { revision: 3, status: "DNF" } });
    expect(await publicRow(raceId, "Bo")).toMatchObject({ status: "DNF" });
    // En senare avläsning ändrar inte brutit (beslutet ligger kvar).
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), { ...okPayload, cardNumber: "67890" }));
    expect(await publicRow(raceId, "Bo")).toMatchObject({ status: "DNF" });
  });
});

describe("steg 31: godkänn valda kontroller", () => {
  it("godkänner en saknad kontroll med orsak, ligger kvar över en ny avläsning och kan tas bort", async () => {
    const { raceId, auth, ada } = await race();
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), missing32));
    expect(await entryStatus(auth, ada)).toMatchObject({ approvableControls: [32], readiness: { APPROVE_CONTROLS: "READY" } });
    expect(await decide(auth, ada, { kind: "APPROVE_CONTROLS", controls: [33], note: "x" }))
      .toMatchObject({ status: "conflict", readiness: "INVALID_CONTROL" });
    expect(await decide(auth, ada, { kind: "APPROVE_CONTROLS", controls: [32], note: "Stämplade med nålen" })).toMatchObject({
      status: "decided", response: { revision: 2, cause: "MANUAL_CONTROL_APPROVAL", status: "OK", reason: "MANUAL_APPROVAL" } });
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), missing32));
    expect(await publicRow(raceId, "Ada")).toMatchObject({ status: "OK", revision: 2 });
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "CONTROL_APPROVAL", decisionNote: "Stämplade med nålen" } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 4, cause: "MANUAL_CONTROL_APPROVAL_WITHDRAWAL", status: "MP" } });
  });
});
