import { describe, expect, it } from "vitest";
import type { UnknownReadoutResolutionCandidateResponse, UnknownReadoutResolutionRequest } from "@o-tid/contracts";
import { entryVariant, linkReview, orderUnknownReadoutEntries, resolutionRequest } from "./unknown-readout-choice";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entry = (n: number, name: string, extra: Partial<UnknownReadoutResolutionCandidateResponse["entries"][number]> = {}) =>
  ({ id: id(n), givenName: name, familyName: "Al", organisationName: null, classId: id(90), entryVersion: 1, activeAssignment: null,
    latestResultRevision: null, latestResult: null, ...extra });
const candidate: UnknownReadoutResolutionCandidateResponse = { formatVersion: 1, raceId: id(99), snapshotVersion: 3, engineVersion: "1",
  readouts: [{ id: id(80), cardNumber: "7505442", readAt: "2026-12-09T08:40:00.000Z", finishPunchedAt: "2026-12-09T08:39:00.000Z",
    fits: [{ classId: id(90), variantCode: "BE", ok: true }] }],
  classes: [{ id: id(90), name: "H21", courseVersionId: id(91), maxEntries: null, entryCount: 3 }],
  entries: [entry(1, "Bo", { activeAssignment: { id: id(70), cardNumber: "8571001" }, latestResultRevision: { id: id(60), revision: 1 },
    latestResult: { status: "OK", elapsedMs: 1_800_000 }, readOut: true }), entry(2, "Cia"), entry(3, "Dan", { activeAssignment: { id: id(71), cardNumber: "8571003" }, courseVariantCode: "AD" }),
  // Brutit utan bricka (ett beslut utan avläsning): visas med status, men kopplingen ersätter inget (steg 45).
  entry(4, "Eva", { latestResultRevision: { id: id(61), revision: 1 }, latestResult: { status: "DNF" }, readOut: false })] };
const request = (entryId: string): UnknownReadoutResolutionRequest => ({ formatVersion: 1, requestId: id(50), readoutId: id(80),
  cardNumber: "7505442", expectedEngineVersion: "1", target: "EXISTING_ENTRY", entryId, expectedEntryVersion: 1, expectedClassId: id(90),
  expectedAssignment: null, expectedLatestResultRevision: null });

describe("kontrollvyns koppling av en okänd bricka (användartestet 2026-11-12)", () => {
  it("deltagare som saknar avläsning står först", () => {
    expect(orderUnknownReadoutEntries(candidate, undefined).map((row) => row.givenName)).toEqual(["Cia", "Dan", "Eva", "Bo"]);
  });

  it("gafflad bana: tilldelad variant som stämplingarna passar först och märkt, annan variant sist (fel D)", () => {
    const forked = { ...candidate, entries: [...candidate.entries, entry(5, "Fia", { courseVariantCode: "BE" })] };
    // Dan har AD (annan variant), Fia BE (just den), Cia och Eva saknar variant; Bo har läst ut och står sist.
    expect(orderUnknownReadoutEntries(forked, id(80)).map((row) => row.givenName)).toEqual(["Fia", "Cia", "Eva", "Dan", "Bo"]);
    expect(entryVariant(forked, id(80), forked.entries[4]!)).toEqual({ code: "BE", same: true });
    expect(entryVariant(forked, id(80), forked.entries[2]!)).toEqual({ code: "AD", same: false });
    expect(entryVariant(forked, id(80), forked.entries[1]!)).toBeUndefined();
  });

  it("granskningen säger vem, nuvarande bricka och resultat och att resultatet ersätts", () => {
    expect(linkReview(candidate, request(id(1)))).toEqual({ name: "Bo Al", className: "H21", cardBefore: "8571001", cardAfter: "7505442",
      result: { status: "OK", elapsedMs: 1_800_000 }, replacesResult: true, changesCard: true });
    expect(linkReview(candidate, request(id(2)))).toMatchObject({ cardBefore: null, result: null, replacesResult: false, changesCard: false });
    expect(linkReview(candidate, request(id(3)))).toMatchObject({ replacesResult: false, changesCard: true,
      variantChange: { assignedCode: "AD", fittingCode: "BE" } });
    expect(linkReview(candidate, request(id(2)))).not.toHaveProperty("variantChange");
    expect(linkReview(candidate, request(id(4)))).toMatchObject({ result: { status: "DNF" }, replacesResult: false });
  });

  it("medgivandet följer bara med när det getts", () => {
    expect(resolutionRequest(request(id(1)), true)).toMatchObject({ replaceExistingResult: true });
    expect(resolutionRequest(request(id(1)), false)).not.toHaveProperty("replaceExistingResult");
  });
});
