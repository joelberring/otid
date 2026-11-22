import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestDeviceBatch } from "../../src";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

/** Granskningen 2.8: högsta sammanhängande löpnummer räknas i databasen och stannar vid första luckan. */
useRaceDatabase();

describe("granskning 2.8: highestContiguousSequence", () => {
  it("stannar före luckan och hoppar över den när den fylls", async () => {
    const { raceId } = await importedRace();
    const deviceId = randomUUID();
    const send = async (sequences: number[]) => {
      let last = 0;
      for (const localSequence of sequences) {
        const payload = { ...okPayload, cardNumber: String(900_000 + localSequence) };
        last = (await ingestDeviceBatch(db, raceId, batch(deviceId, payload, { localSequence }))).highestContiguousSequence;
      }
      return last;
    };
    expect(await send([1, 2, 4])).toBe(2);
    expect(await send([6])).toBe(2);
    expect(await send([3])).toBe(4);
    expect(await send([5])).toBe(6);
    // En annan enhets löpnummer räknas inte med.
    expect((await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload, { localSequence: 2 }))).highestContiguousSequence).toBe(0);
  });
});
