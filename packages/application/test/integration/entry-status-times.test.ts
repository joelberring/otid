import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { ingestDeviceBatch, publicResults } from "../../src";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { applyRaceCorrectionAsAdmin, previewRaceCorrectionAsAdmin } from "../../src/race-corrections";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();
const { decide, entryId, entryStatus, revisions } = statusFlow(db);

async function readOutAda() {
  const { raceId } = await importedRace();
  const auth = await raceAuth(db, raceId);
  await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
  return { raceId, auth, ada: await entryId(raceId, "Ada") };
}

const publicAda = async (raceId: string) => (await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada");

describe("steg 23: ändrad mål- och starttid i statusflödet (ADR-0173 beslut 1)", () => {
  it("rättar måltiden med en ny revision, behåller avläsningen och tar bort rättningen igen", async () => {
    const { raceId, auth, ada } = await readOutAda();
    expect(await entryStatus(auth, ada)).toMatchObject({ readiness: { FINISH_TIME: "READY", START_TIME: "READY" },
      timing: { status: "OK", startTime: "2026-08-30T10:00:00.000Z", finishTime: "2026-08-30T10:40:00.000Z", elapsedMs: 2_400_000,
        latestMatchedSplitElapsedMs: 1_800_000 } });
    expect(await decide(auth, ada, { kind: "FINISH_TIME", finishTime: "2026-08-30T10:25:00Z" }))
      .toMatchObject({ status: "conflict", readiness: "INVALID_TIME" });
    const requestId = randomUUID();
    const corrected = await decide(auth, ada, { kind: "FINISH_TIME", finishTime: "2026-08-30T12:41:00+02:00" }, { requestId });
    expect(corrected).toMatchObject({ status: "decided", response: { revision: 2, cause: "MANUAL_FINISH_TIME_CORRECTION" } });
    expect(await decide(auth, ada, { kind: "FINISH_TIME", finishTime: "2026-08-30T12:41:00+02:00" }, { requestId, expectedRevision: 1 }))
      .toMatchObject({ status: "decided", response: { revision: 2, replayed: true } });
    expect((await revisions(ada))[1]).toMatchObject({ readoutId: null, evaluation: { finishTime: "2026-08-30T10:41:00.000Z", elapsedMs: 2_460_000 } });
    expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId))).toHaveLength(1);
    expect(await publicAda(raceId)).toMatchObject({ revision: 2, status: "OK", elapsedMs: 2_460_000 });

    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "FINISH_TIME", readiness: { WITHDRAW: "READY",
      DISQUALIFIED: "READY", DID_NOT_FINISH: "ACTIVE_MANUAL_TIME" }, timing: { finishTime: "2026-08-30T10:41:00.000Z" },
      withdrawTiming: { finishTime: "2026-08-30T10:40:00.000Z" } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 3, cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" } });
    expect(await publicAda(raceId)).toMatchObject({ revision: 3, elapsedMs: 2_400_000 });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "NONE", readiness: { WITHDRAW: "NO_ACTIVE_DECISION" } });
  });

  it("rättar en stämplad start när starten har en tidsjustering (steg 45)", async () => {
    const { raceId, auth, ada } = await readOutAda();
    // Startenheten gick två minuter efter: alla starttider flyttas fram två minuter.
    const correction = { action: "ADD_TIME_ADJUSTMENT" as const, station: "START" as const, offsetSeconds: 120, reason: "Startklockan" };
    const preview = await previewRaceCorrectionAsAdmin(db, { ...auth, request: { formatVersion: 1, correction } });
    if (preview.status !== "ok") throw new Error(preview.status);
    expect((await applyRaceCorrectionAsAdmin(db, { ...auth, request: { formatVersion: 1, requestId: randomUUID(),
      expectedPreviewHash: preview.response.previewHash, correction } })).status).toBe("applied");
    expect(await publicAda(raceId)).toMatchObject({ status: "OK", elapsedMs: 38 * 60_000 });
    expect(await entryStatus(auth, ada)).toMatchObject({ readiness: { START_TIME: "READY" },
      manualTime: { knownStartTime: "2026-08-30T10:02:00.000Z", readoutFinishTime: "2026-08-30T10:40:00.000Z" } });
    expect(await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T10:01:00Z" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_PUNCH_START_TIME_CORRECTION" } });
    expect(await publicAda(raceId)).toMatchObject({ status: "OK", elapsedMs: 39 * 60_000 });
  });

  it("rättar en stämplad start, prövar mot sträcktiderna och rättningen ligger kvar över en ny avläsning (steg 31)", async () => {
    const { raceId, auth, ada } = await readOutAda();
    expect(await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T10:11:00Z" }))
      .toMatchObject({ status: "conflict", readiness: "INVALID_TIME" });
    expect(await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T09:59:00Z" })).toMatchObject({ status: "decided",
      response: { revision: 2, cause: "MANUAL_PUNCH_START_TIME_CORRECTION" } });
    expect(await publicAda(raceId)).toMatchObject({ revision: 2, status: "OK", elapsedMs: 2_460_000 });
    expect((await revisions(ada))[1]?.evaluation).toMatchObject({ startTime: "2026-08-30T09:59:00.000Z",
      splits: [{ controlCode: 31, elapsedMs: 660_000 }, { controlCode: 32 }, { controlCode: 33 }] });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "START_TIME", withdrawTiming: { startTime: "2026-08-30T10:00:00.000Z" } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 3, cause: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" } });
    expect(await publicAda(raceId)).toMatchObject({ revision: 3, elapsedMs: 2_400_000 });

    // Steg 31: efter borttagningen kan starten rättas igen direkt, och rättningen ligger kvar över nya avläsningar.
    expect(await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T09:58:00Z" })).toMatchObject({ status: "decided",
      response: { revision: 4 } });
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), { ...okPayload, finishPunchedAt: "2026-08-30T10:42:00Z" }));
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "START_TIME" });
    expect(await publicAda(raceId)).toMatchObject({ revision: 4, elapsedMs: 2_520_000 });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided", response: { revision: 6 } });
    expect(await publicAda(raceId)).toMatchObject({ revision: 6, elapsedMs: 2_520_000 });
  });
});
