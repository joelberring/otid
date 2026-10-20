import { describe, expect, it } from "vitest";
import { readoutPackageSchema, type ReadoutPackage, type SportidentReadoutPayload } from "@o-tid/contracts";
import { evaluateLocally, withLocalRegistrations } from "./evaluate";
import { classSuggestions, clubByName, entrySuggestions, runnerForCard, runnerLabel, searchRunners } from "./runner-lookup";
import { syncPending } from "./sync";
import type { QueuedRegistration } from "./store";
import { ids, MemoryReadoutStore, TEST_CARD, testPackage } from "./test-support";

/**
 * PLAN.md steg 29: förslag vid okänd bricka på avläsningssidan, offline mot paketet. Lång har 31 32 33; Kort (ny klass
 * D10) har 31 32. Löpardatabasen har Testa Testsson med bricka 8100101 och Prova Provsson med två brickor.
 */
const SHORT_CLASS = "10000000-0000-4000-8000-000000000020";
const WOMEN_CLASS = "10000000-0000-4000-8000-000000000021";
const NO_CARD = "10000000-0000-4000-8000-000000000022";
const READ_OUT = "10000000-0000-4000-8000-000000000023";
const NAMESAKE = "10000000-0000-4000-8000-000000000024";
const REQUEST = "20000000-0000-4000-8000-000000000031";

function pkg(): ReadoutPackage {
  const base = testPackage();
  const snapshot = base.raceSnapshot;
  const shortVersion = "10000000-0000-4000-8000-000000000025";
  return readoutPackageSchema.parse({ ...base,
    raceSnapshot: { ...snapshot,
      classes: [...snapshot.classes, { id: SHORT_CLASS, raceId: ids.race, name: "D10", courseVersionId: shortVersion, startRule: "PUNCH" },
        { id: WOMEN_CLASS, raceId: ids.race, name: "D21", courseVersionId: ids.version, startRule: "PUNCH" }]
        .sort((left, right) => left.id.localeCompare(right.id)),
      courses: [...snapshot.courses, { id: "10000000-0000-4000-8000-000000000026", raceId: ids.race, name: "Kort", versions: [{
        id: shortVersion, courseId: "10000000-0000-4000-8000-000000000026", version: 1, createdAt: "2026-09-30T10:00:00.000Z",
        controls: [31, 32].map((code, index) => ({ id: `10000000-0000-4000-8000-00000000004${index}`, courseVersionId: shortVersion,
          controlId: `10000000-0000-4000-8000-00000000020${index + 1}`, sequence: index + 1, controlCode: code })) }] }]
        .sort((left, right) => left.id.localeCompare(right.id)),
      entries: [...snapshot.entries,
        { id: NO_CARD, raceId: ids.race, classId: ids.class, givenName: "Cia", familyName: "Utan" },
        { id: READ_OUT, raceId: ids.race, classId: ids.class, givenName: "Dan", familyName: "Klar" },
        { id: NAMESAKE, raceId: ids.race, classId: WOMEN_CLASS, givenName: "Testa", familyName: "Testsson" }]
        .sort((left, right) => left.id.localeCompare(right.id)) },
    readOutEntryIds: [READ_OUT],
    runnerLookup: { organisationName: "OK Skogsfalken", refreshedAt: "2026-10-19T18:00:00.000Z", wholeCountryOnServer: false, truncated: false,
      clubs: [{ id: "9321", name: "OK Skogsfalken", shortName: "Skogsfalken", type: "CLUB" }, { id: "9400", name: "Järfälla OK", type: "CLUB" }],
      runners: [
        { personId: "610101", givenName: "Testa", familyName: "Testsson", birthYear: 1975, sex: "F", clubId: "9321", club: "OK Skogsfalken",
          cards: ["8100101"] },
        { personId: "610102", givenName: "Prova", familyName: "Provsson", birthYear: 1990, sex: "M", clubId: "9321", club: "OK Skogsfalken",
          cards: ["8100102", "8100103"] },
        { personId: "610106", givenName: "Åsa", familyName: "Öberg-Ärling", birthYear: 1969, sex: "F", clubId: "9400", club: "Järfälla OK",
          cards: ["8100106"] }] } });
}

function payload(cardNumber: string, codes: readonly number[]): SportidentReadoutPayload {
  return { cardNumber, cardType: "SI10", startPunchedAt: "2026-10-01T17:00:00.000Z", finishPunchedAt: "2026-10-01T17:30:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-10-01T17:${String(10 + index * 5)}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02"], simulated: true };
}

const registrable = (value: ReadoutPackage) => new Set(value.raceSnapshot.classes.map((raceClass) => raceClass.id));

describe("löpardatabasen i avläsningspaketet (offline)", () => {
  it("brickan ger löparens namn och klubb; namn hittas med och utan å ä ö", () => {
    expect(runnerForCard(pkg(), "8100103")).toMatchObject({ givenName: "Prova", familyName: "Provsson", club: "OK Skogsfalken" });
    expect(runnerForCard(pkg(), "8199999")).toBeUndefined();
    expect(runnerForCard(testPackage(), "8100101")).toBeUndefined();
    expect(searchRunners(pkg(), "oberg").map((row) => row.familyName)).toEqual(["Öberg-Ärling"]);
    expect(searchRunners(pkg(), "Åsa Ärl").map((row) => row.givenName)).toEqual(["Åsa"]);
    expect(searchRunners(pkg(), "te t").map((row) => row.familyName)).toEqual(["Testsson"]);
    expect(searchRunners(pkg(), "t")).toEqual([]);
    expect(runnerLabel(runnerForCard(pkg(), "8100103")!, "8100103")).toBe("Prova Provsson · OK Skogsfalken · 1990 · bricka 8100103");
    expect(clubByName(pkg(), "järfälla ok")?.id).toBe("9400");
    expect(clubByName(pkg(), "Skogsfalken")?.id).toBe("9321");
    expect(clubByName(pkg(), "Okänd klubb")).toBeUndefined();
  });

  it("klassen vars bana passar kommer först; damklass före för en kvinna bland lika passande", () => {
    const value = pkg();
    const full = classSuggestions(value, payload("8100101", [31, 32, 33]), registrable(value), "F");
    expect(full.map((row) => [row.className, row.courseName, row.fit.ok])).toEqual([["D21", "Lång", true], ["Lång", "Lång", true],
      ["D10", "Kort", true]]);
    const man = classSuggestions(value, payload("8100102", [31, 32, 33]), registrable(value), "M");
    expect(man.map((row) => row.className)).toEqual(["D21", "Lång", "D10"]);
    const partial = classSuggestions(value, payload("8100102", [31, 33]), registrable(value));
    expect(partial[0]).toMatchObject({ className: "D21", fit: { ok: false, missingControls: [32] } });
  });

  it("föreslår anmälda utan bricka eller utan avläsning i passande klasser, namnet ur databasen först", () => {
    const value = pkg();
    const classes = classSuggestions(value, payload("8100101", [31, 32, 33]), registrable(value), "F");
    const suggestions = entrySuggestions(value, classes, [], [], runnerForCard(value, "8100101"));
    expect(suggestions.map((row) => [row.name, row.className, row.cardNumber ?? null, row.sameName])).toEqual([
      ["Testa Testsson", "D21", null, true], ["Cia Utan", "Lång", null, false], ["Anna Berg", "Lång", String(TEST_CARD), false]]);
    // Anna läser ut i den här webbläsaren: hon föreslås inte längre.
    const read = [{ raceId: ids.race, deviceId: ids.device, sessionId: ids.session, localSequence: 1, packageVersion: 3,
      stationReceivedAt: "2026-10-01T17:31:00.000Z", payload: payload(String(TEST_CARD), [31, 32, 33]), contentHash: "x", status: "stored" as const }];
    expect(entrySuggestions(value, classes, read, []).map((row) => row.name)).toEqual(["Testa Testsson", "Cia Utan"]);
  });

  it("en köad koppling bedöms lokalt mot den valda deltagaren och skickas med egen idempotensnyckel", async () => {
    const value = pkg();
    const link: QueuedRegistration = { raceId: ids.race, requestId: REQUEST, localSequence: 1, createdAt: "2026-10-01T17:31:00.000Z",
      status: "pending", display: { entryName: "Cia Utan", className: "Lång" },
      request: { formatVersion: 1, requestId: REQUEST, cardNumber: "8100101", target: "EXISTING_ENTRY", entryId: NO_CARD, expectedClassId: ids.class } };
    expect(evaluateLocally(payload("8100101", [31, 32, 33]), withLocalRegistrations(value, [link])))
      .toMatchObject({ status: "OK", name: "Cia Utan", className: "Lång" });
    // Koppling till Anna (som har en bricka): hennes gamla bricka släpps lokalt, som på servern.
    const anna = { ...link, request: { ...link.request, entryId: ids.entry } };
    const linked = withLocalRegistrations(value, [anna]);
    expect(evaluateLocally(payload(String(TEST_CARD), [31, 32, 33]), linked).status).toBe("UNKNOWN_CARD");
    // Fel klass i paketet (deltagaren har bytt klass): kopplingen räknas inte lokalt.
    expect(withLocalRegistrations(value, [{ ...link, request: { ...link.request, expectedClassId: SHORT_CLASS } }])).toBe(value);

    const store = new MemoryReadoutStore();
    await store.addRegistration(link);
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ formatVersion: 1, replayed: false, requestId: REQUEST, raceId: ids.race, cardNumber: "8100101", outcome: "LINKED",
        entryId: NO_CARD, entryName: "Cia Utan", className: "Lång", linkedResult: null, registeredAt: "2026-10-01T17:32:00.000Z" });
    }) as unknown as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "c".repeat(43) })).toEqual({ kind: "synced", count: 0, registered: 1 });
    expect(calls[0]!.url).toContain("/readout-registrations");
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe(`readout-registration:${REQUEST}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(link.request);
    expect(store.registrations[0]).toMatchObject({ status: "stored", response: { outcome: "LINKED" } });
  });
});
