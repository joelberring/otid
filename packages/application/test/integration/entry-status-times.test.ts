import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { ingestDeviceBatch, publicResults } from "../../src";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
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
      DISQUALIFIED: "UNSUPPORTED_RESULT" }, timing: { finishTime: "2026-08-30T10:41:00.000Z" },
      withdrawTiming: { finishTime: "2026-08-30T10:40:00.000Z" } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 3, cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" } });
    expect(await publicAda(raceId)).toMatchObject({ revision: 3, elapsedMs: 2_400_000 });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "NONE", readiness: { WITHDRAW: "NO_ACTIVE_DECISION" } });
  });

  it("rättar en stämplad start, prövar mot sträcktiderna och en ny avläsning ersätter rättningen", async () => {
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

    expect((await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T09:58:00Z" })).status).toBe("conflict");
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), { ...okPayload, finishPunchedAt: "2026-08-30T10:41:00Z" }));
    expect((await decide(auth, ada, { kind: "START_TIME", startTime: "2026-08-30T09:58:00Z" })).status).toBe("decided");
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), { ...okPayload, finishPunchedAt: "2026-08-30T10:42:00Z" }));
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "NONE" });
    expect(await publicAda(raceId)).toMatchObject({ revision: 6, elapsedMs: 2_520_000 });
  });
});
