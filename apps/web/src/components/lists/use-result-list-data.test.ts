import { afterEach, describe, expect, it, vi } from "vitest";
import { createResultListReader } from "./use-result-list-data";

const raceId = "10000000-0000-4000-8000-000000000001";
const results = { formatVersion: 7, results: [] };
const noRelay = { formatVersion: 1, classes: [] };
const radioOff = { formatVersion: 1, raceId, enabled: false, timeZone: "Europe/Stockholm", classes: [], latest: [] };

function stubFetch(relay: unknown, radio: unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url.split("/").at(-1)!);
    const body = url.endsWith("/results") ? results : url.endsWith("/relay-results") ? relay : radio;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe("steg 51: resultatlistans hämtning", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("hämtar stafett och radio varje gång bara när de har innehåll, annars var 30:e sekund", async () => {
    let clock = 0;
    const calls = stubFetch(noRelay, radioOff);
    const read = createResultListReader(() => clock);
    expect(await read(raceId)).toMatchObject({ relay: noRelay, radio: radioOff });
    expect(calls.splice(0)).toEqual(["results", "relay-results", "radio"]);
    clock = 10_000;
    expect(await read(raceId)).toMatchObject({ relay: noRelay, radio: radioOff });
    expect(calls.splice(0)).toEqual(["results"]);
    clock = 30_000;
    await read(raceId);
    expect(calls.splice(0)).toEqual(["results", "relay-results", "radio"]);
  });

  it("en tävling med radio påslagen hämtar radiotiderna varje gång", async () => {
    let clock = 0;
    const calls = stubFetch(noRelay, { ...radioOff, enabled: true });
    const read = createResultListReader(() => clock);
    await read(raceId);
    calls.splice(0);
    clock = 5_000;
    await read(raceId);
    expect(calls).toEqual(["results", "radio"]);
  });
});
