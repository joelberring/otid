import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalizeRocBaseUrl, parseRocPunches, RocAdapterError, rocClient, rocEndpoint, rocLocalTimeToInstant } from "../src/index";

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/roc/${name}`, import.meta.url));
const text = (name: string) => fixture(name).toString("utf8");
const ZONE = "Europe/Stockholm";

async function code(action: () => unknown): Promise<string | undefined> {
  try { await action(); } catch (error) { return error instanceof RocAdapterError ? error.code : "OTHER"; }
  return undefined;
}

/** Svarar med fixturen (eller en text) och sparar adressen som anropades. */
function fakeFetch(body: Uint8Array | string, init: ResponseInit = { status: 200, headers: { "content-type": "text/plain" } }) {
  return vi.fn<typeof fetch>(async () => new Response(body as BodyInit, init));
}

describe("ROC-svar → stämplingar", () => {
  it("läser normala rader med lokal tid i tävlingens tidszon", () => {
    const parsed = parseRocPunches(text("normal.txt"), ZONE);
    expect(parsed.malformedLines).toBe(0);
    expect(parsed.duplicateLines).toBe(0);
    expect(parsed.highestPunchId).toBe(5);
    expect(parsed.punches.map(row => [row.punchId, row.controlCode, row.cardNumber, row.punchedAt])).toEqual([
      [1, 31, "7201", "2026-10-08T16:07:30.000Z"], [2, 31, "7202", "2026-10-08T16:07:20.000Z"],
      [3, 50, "7201", "2026-10-08T16:20:05.000Z"], [4, 31, "7203", "2026-10-08T16:08:00.000Z"],
      [5, 50, "7202", "2026-10-08T16:19:58.000Z"]]);
    expect(parsed.punches[0]).toMatchObject({ localTime: "2026-10-08 18:07:30", rawLine: "1;31;7201;2026-10-08 18:07:30" });
  });

  it("godtar tomt svar (inga nya stämplingar)", () => {
    expect(parseRocPunches(text("empty.txt"), ZONE)).toEqual({ punches: [], malformedLines: 0, duplicateLines: 0, highestPunchId: null });
    expect(parseRocPunches("\n\r\n  \n", ZONE).punches).toEqual([]);
  });

  it("godtar BOM, CRLF och tom sista rad", () => {
    const parsed = parseRocPunches(text("bom-crlf.txt"), ZONE);
    expect(parsed.malformedLines).toBe(0);
    expect(parsed.punches.map(row => [row.punchId, row.cardNumber, row.rawLine])).toEqual([
      [6, "7204", "6;31;7204;2026-10-08 18:09:10"], [7, "7204", "7;50;7204;2026-10-08 18:21:00"]]);
    // Bara CR som radslut fungerar också.
    expect(parseRocPunches("1;31;7201;2026-10-08 18:07:30\r2;31;7202;2026-10-08 18:07:20", ZONE).punches).toHaveLength(2);
  });

  it("hoppar över och räknar trasiga rader utan att krascha", () => {
    const parsed = parseRocPunches(text("malformed.txt"), ZONE);
    expect(parsed.malformedLines).toBe(7);
    expect(parsed.punches.map(row => [row.punchId, row.controlCode, row.cardNumber])).toEqual([[8, 31, "7205"], [14, 50, "7205"], [15, 31, "7207"]]);
    // Mellanslag runt fälten godtas men raden sparas som den kom.
    expect(parsed.punches[1]!.rawLine).toBe(" 14 ; 50 ; 007205 ; 2026-10-08 18:22:00 ");
    expect(parsed.highestPunchId).toBe(15);
    for (const line of ["0;31;7201;2026-10-08 18:00:00", "1;0;7201;2026-10-08 18:00:00", "1;31;0;2026-10-08 18:00:00",
      "1;31;123456789;2026-10-08 18:00:00", "99999999999999999;31;1;2026-10-08 18:00:00", "1;31;7201;1999-12-31 23:59:59",
      "1;31;7201;2026-10-08", "<html>"]) {
      expect(parseRocPunches(line, ZONE).malformedLines, line).toBe(1);
    }
  });

  it("räknar dubbletter: samma id och samma stämpling med nytt id", () => {
    const parsed = parseRocPunches(text("duplicates.txt"), ZONE);
    expect(parsed.duplicateLines).toBe(2);
    expect(parsed.punches.map(row => row.punchId)).toEqual([16, 18]);
    expect(parsed.highestPunchId).toBe(18);
  });

  it("litar inte på att id:n ökar: högsta id blir nästa lastId", () => {
    const parsed = parseRocPunches(text("unordered.txt"), ZONE);
    expect(parsed.punches.map(row => row.punchId)).toEqual([22, 20, 21]);
    expect(parsed.highestPunchId).toBe(22);
  });

  it("tolkar tiden runt sommar- och vintertid", () => {
    const parsed = parseRocPunches(text("dst.txt"), ZONE);
    // 02:30 den 29 mars finns inte i Sverige: raden räknas som trasig.
    expect(parsed.malformedLines).toBe(1);
    expect(Object.fromEntries(parsed.punches.map(row => [row.punchId, row.punchedAt]))).toEqual({
      30: "2026-03-29T00:59:59.000Z", 32: "2026-03-29T01:00:00.000Z",
      // 02:30 den 25 oktober finns två gånger: den första (sommartid) väljs.
      33: "2026-10-25T00:30:00.000Z", 34: "2026-10-25T02:30:00.000Z" });
    expect(rocLocalTimeToInstant("2026-10-08 18:07:30", "UTC")).toBe("2026-10-08T18:07:30.000Z");
    expect(rocLocalTimeToInstant("2026-07-01 12:00:00", "America/New_York")).toBe("2026-07-01T16:00:00.000Z");
    expect(rocLocalTimeToInstant("2026-10-08T18:07:30.250", ZONE)).toBe("2026-10-08T16:07:30.000Z");
  });

  it("kräver en giltig tidszon", async () => {
    expect(await code(() => parseRocPunches("", "Mars/Olympus"))).toBe("INVALID_INPUT");
  });
});

describe("ROC-klienten", () => {
  it("anropar ROC eller OResults med unitId och lastId", async () => {
    const fetch = fakeFetch(fixture("normal.txt"));
    const result = await rocClient({ source: "ORESULTS", fetch }).fetchPunches({ unitId: "abc-123", lastId: 0, timeZone: ZONE });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.oresults.eu/roc?unitId=abc-123&lastId=0");
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(result.punches).toHaveLength(5);
    expect(result.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rocEndpoint("ROC", { unitId: "4711", lastId: 17 })).toBe("https://roc.olresultat.se/ver7.1/getpunches.php?unitId=4711&lastId=17");
    // Testserver: bara ursprunget byts, sökvägen behålls.
    expect(rocEndpoint("ROC", { unitId: "4711", lastId: 17 }, "http://127.0.0.1:4331/"))
      .toBe("http://127.0.0.1:4331/ver7.1/getpunches.php?unitId=4711&lastId=17");
  });

  it("godtar tomma svar och text/html-svar som är stämplingar, men inte HTML-sidor", async () => {
    const empty = await rocClient({ source: "ROC", fetch: fakeFetch(fixture("empty.txt")) })
      .fetchPunches({ unitId: "4711", lastId: 5, timeZone: ZONE });
    expect(empty.punches).toEqual([]);
    const php = await rocClient({ source: "ROC", fetch: fakeFetch(fixture("normal.txt"), { status: 200, headers: { "content-type": "text/html" } }) })
      .fetchPunches({ unitId: "4711", lastId: 0, timeZone: ZONE });
    expect(php.punches).toHaveLength(5);
    expect(await code(() => rocClient({ source: "ROC", fetch: fakeFetch("<html><body>Fel</body></html>") })
      .fetchPunches({ unitId: "4711", lastId: 0, timeZone: ZONE }))).toBe("INVALID_RESPONSE");
    expect(await code(() => rocClient({ source: "ROC", fetch: fakeFetch("Unknown unit\n") })
      .fetchPunches({ unitId: "4711", lastId: 0, timeZone: ZONE }))).toBe("INVALID_RESPONSE");
  });

  it("ger felkoder utan innehåll", async () => {
    const call = (fetch: typeof globalThis.fetch, extra: { timeoutMs?: number } = {}) =>
      code(() => rocClient({ source: "ORESULTS", fetch, ...extra }).fetchPunches({ unitId: "x", lastId: 0, timeZone: ZONE }));
    expect(await call(fakeFetch("", { status: 403 }))).toBe("REJECTED");
    expect(await call(fakeFetch("", { status: 404 }))).toBe("NOT_FOUND");
    expect(await call(fakeFetch("", { status: 502 }))).toBe("UPSTREAM_UNAVAILABLE");
    expect(await call(vi.fn<typeof fetch>(async () => { throw new TypeError("fetch failed"); }))).toBe("UPSTREAM_UNAVAILABLE");
    expect(await call(fakeFetch("1;31;7201;2026-10-08 18:07:30\n", { status: 200, headers: { "content-length": String(3 * 1024 * 1024) } })))
      .toBe("RESPONSE_TOO_LARGE");
    const slow = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    expect(await call(slow, { timeoutMs: 20 })).toBe("TIMEOUT");
  });

  it("vägrar ogiltig enhet, lastId och testadress", async () => {
    const client = rocClient({ source: "ROC", fetch: fakeFetch("") });
    expect(await code(() => client.fetchPunches({ unitId: "", lastId: 0, timeZone: ZONE }))).toBe("INVALID_INPUT");
    expect(await code(() => client.fetchPunches({ unitId: "../x", lastId: 0, timeZone: ZONE }))).toBe("INVALID_INPUT");
    expect(await code(() => client.fetchPunches({ unitId: "4711", lastId: -1, timeZone: ZONE }))).toBe("INVALID_INPUT");
    expect(await code(() => client.fetchPunches({ unitId: "4711", lastId: 1.5, timeZone: ZONE }))).toBe("INVALID_INPUT");
    expect(await code(() => normalizeRocBaseUrl("ftp://x"))).toBe("INVALID_INPUT");
    expect(await code(() => normalizeRocBaseUrl("http://x/roc"))).toBe("INVALID_INPUT");
    expect(await code(() => normalizeRocBaseUrl("http://user:pw@x"))).toBe("INVALID_INPUT");
    expect(normalizeRocBaseUrl("http://127.0.0.1:4331")).toBe("http://127.0.0.1:4331");
  });
});
