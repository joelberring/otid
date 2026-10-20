import { describe, expect, it } from "vitest";
import type { SportidentReadoutPayload } from "@o-tid/contracts";
import { evaluateLocally, withLocalRegistrations } from "./evaluate";
import { ids, TEST_CARD, testPackage } from "./test-support";
import type { QueuedRegistration } from "./store";

/** Steg 31 (B4): avläsningssidan märker en bricka som redan lästs ut för någon annan (lånad bricka?). */
function payload(finish: string): SportidentReadoutPayload {
  return { cardNumber: String(TEST_CARD), cardType: "SI10", startPunchedAt: "2026-10-01T17:00:00.000Z", finishPunchedAt: finish,
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-10-01T17:${10 + index * 5}:00.000Z` })),
    untimedPunchCodes: [], frames: ["00"], simulated: true };
}

describe("lånad bricka på avläsningssidan", () => {
  it("märker en annorlunda avläsning av samma bricka som säker, en likadan inte", () => {
    const pkg = testPackage();
    const first = payload("2026-10-01T17:30:00.000Z"), again = payload("2026-10-01T17:30:00.000Z");
    const corrected = payload("2026-10-01T17:31:00.000Z");
    const other = { ...payload("2026-10-01T18:30:00.000Z"), startPunchedAt: "2026-10-01T18:00:00.000Z",
      punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-10-01T18:${10 + index * 5}:00.000Z` })) };
    expect(evaluateLocally(first, pkg).alreadyReadOutBy).toBeUndefined();
    expect(evaluateLocally(again, pkg, [first]).alreadyReadOutBy).toBeUndefined();
    // Samma lopp med ändrad måltid: samma löpare.
    expect(evaluateLocally(corrected, pkg, [first]).alreadyReadOutBy).toBeUndefined();
    expect(evaluateLocally(other, pkg, [first]).alreadyReadOutBy).toMatchObject({ entryId: ids.entry, name: "Anna Berg", certain: true });
  });

  it("märker en löpare som redan har resultat enligt paketet som möjlig, och flyttar brickan vid lånad bricka", () => {
    const pkg = { ...testPackage(), readOutEntryIds: [ids.entry] };
    expect(evaluateLocally(payload("2026-10-01T18:30:00.000Z"), pkg).alreadyReadOutBy).toMatchObject({ certain: false });
    const registration: QueuedRegistration = { raceId: ids.race, requestId: "20000000-0000-4000-8000-000000000001", localSequence: 2,
      createdAt: "2026-10-01T18:31:00.000Z", status: "pending", request: { formatVersion: 1, requestId: "20000000-0000-4000-8000-000000000001",
        cardNumber: String(TEST_CARD), classId: ids.class, givenName: "Lina", familyName: "Lånad", organisationName: null, borrowedCard: true } };
    const local = withLocalRegistrations(pkg, [registration]);
    expect(evaluateLocally(payload("2026-10-01T18:30:00.000Z"), local)).toMatchObject({ name: "Lina Lånad", status: "OK" });
  });
});
