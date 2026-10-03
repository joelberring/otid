import { describe, expect, it } from "vitest";
import { eventorEntryImportCommitRequestSchema } from "@o-tid/contracts";
import { canonicalEventorEntryImportMappings, eventorEntryImportFieldsMatch, eventorEntryImportIntentHash, eventorEntryImportMappingHash } from "../src/eventor-import";

const grantId = "10000000-0000-4000-8000-000000000001";
const classA = "10000000-0000-4000-8000-000000000002";
const classB = "10000000-0000-4000-8000-000000000003";
const input = (mappings: unknown) => eventorEntryImportCommitRequestSchema.parse({
  formatVersion: 1, grantId, eventClassesSourceHash: "a".repeat(64), entriesSourceHash: "b".repeat(64), mappings
});

it("allows only exact existing importer fields to be left unchanged", () => {
  const existing = { classId: classA, givenName: "Åsa", familyName: "Test", organisationName: "IF Test" };
  expect(eventorEntryImportFieldsMatch(existing, { ...existing, organisationName: "IF Test" })).toBe(true);
  expect(eventorEntryImportFieldsMatch(existing, { ...existing, givenName: "Anna" })).toBe(false);
  expect(eventorEntryImportFieldsMatch(existing, { ...existing, classId: classB })).toBe(false);
});

describe("Eventor entry import intent", () => {
  it("sorts mapping intent and hashes permutations identically", () => {
    const first = input([{ externalClassId: "H21", classId: classB }, { externalClassId: "D21", classId: classA }]);
    const second = input([{ externalClassId: "D21", classId: classA }, { externalClassId: "H21", classId: classB }]);
    expect(canonicalEventorEntryImportMappings(first)).toEqual([
      { externalClassId: "D21", classId: classA }, { externalClassId: "H21", classId: classB }
    ]);
    expect(eventorEntryImportMappingHash(first)).toBe(eventorEntryImportMappingHash(second));
    expect(eventorEntryImportIntentHash(first, { raceId: classA, grantId, actorCredentialId: classB }))
      .toBe(eventorEntryImportIntentHash(second, { raceId: classA, grantId, actorCredentialId: classB }));
    expect(eventorEntryImportIntentHash(first, { raceId: classA, grantId, actorCredentialId: classB }))
      .not.toBe(eventorEntryImportIntentHash(first, { raceId: classA, grantId: classB, actorCredentialId: classB }));
  });
});
