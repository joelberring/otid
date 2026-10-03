import { describe, expect, it } from "vitest";
import { matchEntryRegistrationCandidates } from "../src/entry-registration-matching";

const entry = { entryId: "10000000-0000-4000-8000-000000000001",
  classId: "20000000-0000-4000-8000-000000000001", className: "Öppen",
  givenName: "Åsa   Maria", familyName: "Öberg", organisationName: "Annan klubb" };
const query = { formatVersion: 1 as const, expectedSnapshotVersion: 2,
  givenName: " A\u030asa\tMaria ", familyName: "ÖBERG", cardNumber: null };

describe("TASK028 rådgivande namn-/brickmatchning", () => {
  it("jämför hela namn med NFC, whitespace och svensk gemen utan att ändra visning", () => {
    const result = matchEntryRegistrationCandidates([entry], query, new Set());
    expect(result).toEqual({ totalMatches: 1, candidates: [{ ...entry, reasons: ["SAME_NAME"] }] });
    expect(entry.givenName).toBe("Åsa   Maria");
  });
  it("gissar inte delnamn, diakritik, namnordning eller bindestreck", () => {
    for (const givenName of ["Asa Maria", "Åsa", "Maria Åsa", "Åsa-Maria"]) {
      expect(matchEntryRegistrationCandidates([entry], { ...query, givenName }, new Set()).totalMatches).toBe(0);
    }
  });
  it("visar annan namnägare till brickan och kombinerar två orsaker på en rad", () => {
    const owners = new Set([entry.entryId]);
    expect(matchEntryRegistrationCandidates([entry], { ...query, givenName: "Bo", cardNumber: "12345" }, owners)
      .candidates[0]?.reasons).toEqual(["CARD_ALREADY_ASSIGNED"]);
    expect(matchEntryRegistrationCandidates([entry], { ...query, cardNumber: "12345" }, owners)
      .candidates[0]?.reasons).toEqual(["SAME_NAME", "CARD_ALREADY_ASSIGNED"]);
    expect(matchEntryRegistrationCandidates([entry], { ...query, givenName: "Bo" }, owners).totalMatches).toBe(0);
  });
  it("räknar alla träffar före begränsning och prioriterar brickägare deterministiskt", () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({ ...entry,
      entryId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    const ownerId = entries[29]?.entryId ?? "";
    const result = matchEntryRegistrationCandidates(entries, { ...query, cardNumber: "12345" }, new Set([ownerId]));
    expect(result.totalMatches).toBe(30);
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates[0]?.entryId).toBe(ownerId);
    expect(result.candidates[1]?.entryId).toBe(entries[0]?.entryId);
    expect(matchEntryRegistrationCandidates([...entries].reverse(), { ...query, cardNumber: "12345" }, new Set([ownerId]))).toEqual(result);
  });
});
