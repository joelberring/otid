import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { contentHash, ingestDeviceBatch, storeIngestedReadout } from "../../src";
import { statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

/**
 * Granskning 2.1: en lånad bricka som läses ut på två datorer samtidigt. Den första avläsningens resultat är ännu inte
 * committat när den andra börjar; den andra ska vänta på deltagarraden och sedan se det, inte skriva över det.
 */
useRaceDatabase();
const { entryId, revisions } = statusFlow(db);
const second = { ...okPayload, startPunchedAt: "2026-08-30T11:00:00Z", finishPunchedAt: "2026-08-30T11:50:00Z",
  punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T11:${10 + index * 10}:00Z` })) };

describe("granskning 2.1: samtidig avläsning av en lånad bricka", () => {
  it("den andra avläsningen blir okänd i stället för att skriva över den förstes ännu ocommittade resultat", async () => {
    const { raceId } = await importedRace();
    const ada = await entryId(raceId, "Ada");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let firstStored!: () => void;
    const firstIsStored = new Promise<void>((resolve) => { firstStored = resolve; });

    // Dator 1: avläsningen är sparad men transaktionen är öppen.
    const first = db.transaction(async (tx) => {
      const [raw] = await tx.insert(schema.rawDeviceMessages).values({ raceId, deviceId: randomUUID(), sessionId: randomUUID(),
        localSequence: 1, packageVersion: 3, stationReceivedAt: new Date("2026-08-30T10:41:00Z"), transport: "simulator",
        rawPayload: okPayload, contentHash: contentHash(okPayload) }).returning();
      const result = await storeIngestedReadout(tx, raceId, raw!.id, okPayload, new Date("2026-08-30T10:41:00Z"));
      firstStored();
      await held;
      return result;
    });
    await firstIsStored;

    // Dator 2: kommer medan dator 1 håller deltagaren.
    let secondDone = false;
    const secondRun = ingestDeviceBatch(db, raceId, batch(randomUUID(), second, { stationReceivedAt: "2026-08-30T11:55:00Z" }))
      .then((value) => { secondDone = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(secondDone).toBe(false);
    release();
    expect(await first).toMatchObject({ status: "OK" });
    const [borrowed] = (await secondRun).acknowledgements;
    expect(borrowed).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    expect(await revisions(ada)).toHaveLength(1);
    const readouts = await db.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
    expect(readouts).toHaveLength(2);
  });
});
