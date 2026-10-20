import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { Command, encodeStationFrame } from "../../../sportident/src";
import { nattKmBlockFrame, nattKmDetection } from "../../../sportident/test/fixtures/siac-natt-km";
import { contentHash, ingestDeviceBatch } from "../../src";
import { db, importedRace, useRaceDatabase } from "./race-fixtures";

/**
 * Steg 36: en station som skickar alla åtta block ger (med steg 34) detektering + 8 block = 9 ramar, och med
 * uttagsramen och dubbletter upp till tolv. Servern tar emot dem och sparar ramarna oförändrade.
 */
useRaceDatabase();
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const hexFrames = (count: number) => [nattKmDetection(), ...[0, 1, 2, 3, 4, 5, 6, 7].map((number) => nattKmBlockFrame(number)),
  encodeStationFrame(Command.CARD_REMOVED, 0x1a, [0, 0, 0, 0]), nattKmBlockFrame(7), nattKmBlockFrame(7), nattKmBlockFrame(7)]
  .slice(0, count).map(toHex);

function sportidentBatch(frames: string[], localSequence: number, deviceId: string) {
  const payload = { cardNumber: "8001234", cardType: "SIAC" as const, startPunchedAt: "2026-08-30T16:47:56.000Z",
    finishPunchedAt: "2026-08-30T17:41:19.000Z", punches: [{ code: 31, punchedAt: "2026-08-30T16:50:12.000Z" }],
    untimedPunchCodes: [], frames, clockSource: "station" as const, clockOffsetMs: 0, simulated: false };
  return { deviceId, sessionId: deviceId, packageVersion: 3, firstSequence: localSequence, lastSequence: localSequence,
    events: [{ localSequence, stationReceivedAt: "2026-08-30T17:45:00.000Z", transport: "sportident" as const, payload,
      contentHash: contentHash(payload) }] };
}

describe("steg 36: avläsning med nio till tolv råramar", () => {
  it("tar emot 9 och 12 ramar och sparar dem oförändrade; 13 avvisas", async () => {
    const { raceId } = await importedRace();
    const deviceId = randomUUID();
    for (const [index, count] of [9, 12].entries()) {
      const input = sportidentBatch(hexFrames(count), index + 1, deviceId);
      const ack = await ingestDeviceBatch(db, raceId, input);
      expect(ack.acknowledgements[0]).toMatchObject({ status: "stored" });
      const [raw] = await db.select().from(schema.rawDeviceMessages)
        .where(eq(schema.rawDeviceMessages.id, (ack.acknowledgements[0] as { rawMessageId: string }).rawMessageId));
      expect((raw!.rawPayload as { frames: string[] }).frames).toEqual(hexFrames(count));
    }
    await expect(ingestDeviceBatch(db, raceId, sportidentBatch([...hexFrames(12), hexFrames(1)[0]!], 3, deviceId))).rejects.toThrow();
  });
});
