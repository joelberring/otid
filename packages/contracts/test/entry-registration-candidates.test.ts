import { describe, expect, it } from "vitest";
import { entryRegistrationCandidatesRequestSchema, entryRegistrationCandidatesResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const query = { formatVersion: 1, expectedSnapshotVersion: 2,
  givenName: " Anna ", familyName: " Andersson ", cardNumber: null };
const candidate = { entryId: id, classId: id, className: "Öppen",
  givenName: "Anna", familyName: "Andersson", organisationName: null, reasons: ["SAME_NAME"] };
const response = { formatVersion: 1, raceId: id, snapshotVersion: 2, totalMatches: 1, candidates: [candidate] };

describe("TASK028 kandidatkontrakt", () => {
  it("normaliserar indata men avvisar okänt scope, ogiltig bricka och tomma namn", () => {
    expect(entryRegistrationCandidatesRequestSchema.parse(query)).toMatchObject({ givenName: "Anna", familyName: "Andersson" });
    for (const change of [{ givenName: " " }, { familyName: "a".repeat(161) },
      { cardNumber: "0123" }, { expectedSnapshotVersion: 0 }, { raceId: id }]) {
      expect(entryRegistrationCandidatesRequestSchema.safeParse({ ...query, ...change }).success).toBe(false);
    }
  });
  it("binder antal till unika kandidater och accepterar historisk klubbtext", () => {
    expect(entryRegistrationCandidatesResponseSchema.safeParse(response).success).toBe(true);
    expect(entryRegistrationCandidatesResponseSchema.safeParse({ ...response, candidates: [
      { ...candidate, organisationName: "a".repeat(240), reasons: ["SAME_NAME", "CARD_ALREADY_ASSIGNED"] }
    ] }).success).toBe(true);
    for (const change of [{ totalMatches: 0 }, { totalMatches: 2 },
      { totalMatches: 2, candidates: [candidate, candidate] },
      { candidates: [{ ...candidate, reasons: [] }] },
      { candidates: [{ ...candidate, reasons: ["SAME_NAME", "SAME_NAME"] }] },
      { candidates: [{ ...candidate, organisationName: "a".repeat(241) }] },
      { candidates: [{ ...candidate, cardNumber: "12345" }] }]) {
      expect(entryRegistrationCandidatesResponseSchema.safeParse({ ...response, ...change }).success).toBe(false);
    }
  });
  it("kräver exakt första sidans storlek även vid fler träffar", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({ ...candidate,
      entryId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    expect(entryRegistrationCandidatesResponseSchema.safeParse({ ...response, totalMatches: 45, candidates }).success).toBe(true);
    expect(entryRegistrationCandidatesResponseSchema.safeParse({ ...response, totalMatches: 45, candidates: candidates.slice(1) }).success).toBe(false);
    expect(entryRegistrationCandidatesResponseSchema.safeParse({ ...response, totalMatches: 0, candidates: [] }).success).toBe(true);
  });
});
