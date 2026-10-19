import { expect, it } from "vitest";
import { entryIdentityAdminListResponseSchema, entryIdentityChangeRequestSchema, entryIdentityChangeResponseSchema } from "../src/entry-identity-admin";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const classId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const before = { givenName: "Åsa", familyName: "Exempel", organisationName: "Test OK" };
const after = { ...before, familyName: "Exempelsson", organisationName: null };
const request = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: classId,
  expectedIdentity: before, identity: after };
const response = { formatVersion: 1, raceId, entryId, classId, requestId, replayed: false,
  previousIdentity: before, identity: after, entryVersionBefore: 2, entryVersionAfter: 3,
  snapshotVersionBefore: 4, snapshotVersionAfter: 5, changedAt: "2026-09-09T10:00:00Z" };

it("trims only new input and represents intentional removal of club", () => {
  const result = entryIdentityChangeRequestSchema.parse({ ...request,
    expectedIdentity: { ...before, givenName: " Åsa " },
    identity: { ...after, givenName: " Åsa " } });
  expect(result.expectedIdentity.givenName).toBe(" Åsa ");
  expect(result.identity).toEqual(after);
  expect(entryIdentityChangeRequestSchema.parse({ ...request,
    identity: { ...after, organisationName: "x".repeat(200) } }).identity.organisationName).toHaveLength(200);
  expect(entryIdentityChangeRequestSchema.parse({ ...request,
    expectedIdentity: { ...before, organisationName: "x".repeat(240) } }).expectedIdentity.organisationName).toHaveLength(240);
});

it("rejects missing concurrency fields, unrelated edits and invalid new text", () => {
  for (const key of ["expectedEntryVersion", "expectedClassId", "expectedIdentity"]) {
    expect(entryIdentityChangeRequestSchema.safeParse({ ...request, [key]: undefined }).success).toBe(false);
  }
  for (const identity of [
    { ...after, givenName: "  " }, { ...after, familyName: "x".repeat(161) },
    { ...after, organisationName: "" }, { ...after, organisationName: "x".repeat(201) },
    { ...after, externalId: "123" }, { ...after, cardNumber: "123456" }
  ]) expect(entryIdentityChangeRequestSchema.safeParse({ ...request, identity }).success).toBe(false);
  expect(entryIdentityChangeRequestSchema.safeParse({ ...request, classId: entryId }).success).toBe(false);
  for (const expectedEntryVersion of [0, 1.5, 2_147_483_648]) {
    expect(entryIdentityChangeRequestSchema.safeParse({ ...request, expectedEntryVersion }).success).toBe(false);
  }
});

it("validates actual change and exact version increments in both initial and replay responses", () => {
  expect(entryIdentityChangeResponseSchema.parse(response)).toEqual(response);
  expect(entryIdentityChangeResponseSchema.parse({ ...response, replayed: true }).replayed).toBe(true);
  for (const changed of [
    { ...response, identity: before }, { ...response, entryVersionAfter: 4 },
    { ...response, snapshotVersionAfter: 4 }, { ...response, actorName: "Private" },
    { ...response, changedAt: "2026-02-30T10:00:00Z" }
  ]) expect(entryIdentityChangeResponseSchema.safeParse(changed).success).toBe(false);
});


it("rejects duplicate entries and unrelated private data in the bounded list", () => {
  const entry = { id: entryId, classId, className: "Öppen", version: 2, identity: before };
  const list = { formatVersion: 1, raceId, snapshotVersion: 4, entries: [entry] };
  expect(entryIdentityAdminListResponseSchema.parse(list)).toEqual(list);
  expect(entryIdentityAdminListResponseSchema.safeParse({ ...list, entries: [] }).success).toBe(true);
  expect(entryIdentityAdminListResponseSchema.safeParse({ ...list, entries: [entry, entry] }).success).toBe(false);
  expect(entryIdentityAdminListResponseSchema.safeParse({ ...list,
    entries: [{ ...entry, credential: "secret" }] }).success).toBe(false);
});
