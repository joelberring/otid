import { describe, expect, it } from "vitest";
import { uninterpretedReadoutRequestSchema } from "@o-tid/contracts";
import { failedReadoutsFile, syncFailedReadouts, type FailedReadout } from "./failed-readouts";
import { ids } from "./test-support";

const identity = { deviceId: ids.device, sessionId: ids.session };
const row = (overrides: Partial<FailedReadout> = {}): FailedReadout => ({ cardNumber: "7123456", at: "2026-10-25T17:45:00.000Z",
  message: "Tiden går inte att placera", frames: ["02ef0101", "02ef0202"], ...overrides });

function memory(rows: FailedReadout[]) {
  let saved = rows;
  return { load: () => saved, save: (_raceId: string, next: readonly FailedReadout[]) => { saved = [...next]; }, rows: () => saved };
}

describe("otolkade avläsningar till servern (steg 45)", () => {
  it("skickar råramarna en gång och markerar dem först när servern kvitterat", async () => {
    const storage = memory([row({ requestId: "10000000-0000-4000-8000-0000000000a1", simulated: false, stationSerial: 510_235 }), row()]);
    const sent: unknown[] = [];
    let n = 0;
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { requestId: string };
      sent.push(body);
      return Response.json({ formatVersion: 1, raceId: ids.race, requestId: body.requestId,
        rawMessageId: "10000000-0000-4000-8000-0000000000f1", status: "stored" });
    }) as typeof globalThis.fetch;
    const newId = () => `10000000-0000-4000-8000-0000000000b${++n}`;
    expect(await syncFailedReadouts(ids.race, identity, 3, { fetch, csrf: () => "token" }, storage, newId)).toEqual({ kind: "done", stored: 2 });
    expect(sent).toHaveLength(2);
    expect(uninterpretedReadoutRequestSchema.parse(sent[0])).toMatchObject({ requestId: "10000000-0000-4000-8000-0000000000a1",
      deviceId: ids.device, packageVersion: 3, stationReceivedAt: "2026-10-25T17:45:00.000Z",
      payload: { cardNumber: "7123456", frames: ["02ef0101", "02ef0202"], stationSerial: 510_235, simulated: false } });
    // En rad från före steg 45 får ett id.
    expect(uninterpretedReadoutRequestSchema.parse(sent[1])).toMatchObject({ requestId: "10000000-0000-4000-8000-0000000000b1" });
    expect(storage.rows().every((candidate) => candidate.storedAt)).toBe(true);
    expect(await syncFailedReadouts(ids.race, identity, 3, { fetch, csrf: () => "token" }, storage, newId)).toEqual({ kind: "done", stored: 0 });
    expect(sent).toHaveLength(2);
  });

  it("behåller raden vid nätfel, utloggning och serverfel", async () => {
    const storage = memory([row({ requestId: "10000000-0000-4000-8000-0000000000a1" })]);
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof globalThis.fetch;
    expect(await syncFailedReadouts(ids.race, identity, 3, { fetch: offline, csrf: () => "token" }, storage)).toEqual({ kind: "offline" });
    const broken = (async () => new Response(null, { status: 500 })) as typeof globalThis.fetch;
    expect(await syncFailedReadouts(ids.race, identity, 3, { fetch: broken, csrf: () => "token" }, storage)).toEqual({ kind: "failed", status: 500 });
    expect(await syncFailedReadouts(ids.race, identity, 3, { fetch: broken, csrf: () => undefined }, storage)).toEqual({ kind: "unauthorized" });
    expect(storage.rows()[0]!.storedAt).toBeUndefined();
    expect(JSON.parse(failedReadoutsFile(ids.race, storage.rows()))).toMatchObject({ format: "otid-failed-readouts", raceId: ids.race,
      readouts: [{ cardNumber: "7123456", frames: ["02ef0101", "02ef0202"] }] });
  });
});
