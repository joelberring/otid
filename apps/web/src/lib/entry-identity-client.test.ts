import { expect, it } from "vitest";
import { appendIdentityHistory, filterEntryIdentities, parseIdentityReceipt, type IdentityAttempt } from "./entry-identity-client";
const id = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const before = { givenName: "Åsa", familyName: "Löpare", organisationName: "Östra OK" };
const after = { ...before, givenName: "Åse", organisationName: null };
const attempt: IdentityAttempt = { id, entryId: id, request: { formatVersion: 1, expectedEntryVersion: 1,
  expectedClassId: id, expectedSnapshotVersion: 3, expectedIdentity: before, identity: after } };
const item = { requestId: id, classId: id, previousIdentity: before, identity: after,
  entryVersionBefore: 1, entryVersionAfter: 2, snapshotVersionBefore: 3, snapshotVersionAfter: 4, changedAt: "2026-09-09T10:00:00Z" };
it("filters NFC names, club and class without changing entries or server order", () => {
  const entries = [{ id, classId: id, className: "D21", version: 1, identity: before },
    { id: other, classId: id, className: "D21", version: 1, identity: { ...before, givenName: "Bo" } }];
  expect(filterEntryIdentities(entries, "a\u030asa")).toEqual([entries[0]]);
  expect(filterEntryIdentities(entries, "ÖSTRA")).toEqual(entries);
  expect(filterEntryIdentities(entries, "d21")).toEqual(entries);
  expect(filterEntryIdentities(entries, "ingenträff")).toEqual([]);
  expect(entries[0]?.identity.givenName).toBe("Åsa");
});
it("requires exact receipt scope, previous values, normalized intent and versions", () => {
  const receipt = { ...item, formatVersion: 1, raceId: id, entryId: id, replayed: true };
  expect(parseIdentityReceipt(receipt, id, attempt)).toEqual(receipt);
  for (const patch of [{ raceId: other }, { entryId: other }, { requestId: other }, { classId: other },
    { previousIdentity: { ...before, givenName: "Fel" } }, { identity: { ...after, organisationName: "Fel" } },
    { entryVersionBefore: 2, entryVersionAfter: 3 }, { snapshotVersionBefore: 4, snapshotVersionAfter: 5 }]) {
    expect(() => parseIdentityReceipt({ ...receipt, ...patch }, id, attempt)).toThrow();
  }
});
it("appends ordered explicit pages and rejects cross-scope, duplicates and cursor loops", () => {
  const older = { ...item, requestId: other };
  const newer = { ...item, entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 4, snapshotVersionAfter: 5 };
  const page = { formatVersion: 1 as const, raceId: id, entryId: id, items: [newer], nextCursor: "YWJj" };
  const next = { ...page, items: [older], nextCursor: null };
  expect(appendIdentityHistory(next, id, id, page).items).toEqual([newer, older]);
  for (const bad of [{ ...next, entryId: other }, { ...next, raceId: other },
    { ...next, items: [newer] }, { ...next, nextCursor: "YWJj" }]) {
    expect(() => appendIdentityHistory(bad, id, id, page)).toThrow();
  }
});
