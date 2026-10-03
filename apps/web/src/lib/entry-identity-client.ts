import { entryIdentityChangeResponseSchema, entryIdentityHistoryResponseSchema,
  type EntryIdentityChangeRequest, type EntryIdentityAdminListResponse, type EntryIdentityHistoryResponse } from "@o-tid/contracts";

export type IdentityAttempt = { id: string; entryId: string; request: EntryIdentityChangeRequest };
export function filterEntryIdentities(entries: EntryIdentityAdminListResponse["entries"], query: string) {
  const fold = (value: string) => value.normalize("NFC").toLocaleLowerCase("sv-SE");
  const needle = fold(query.trim());
  return entries.filter((entry) => fold([entry.identity.givenName, entry.identity.familyName,
    entry.identity.organisationName ?? "", entry.className].join(" ")).includes(needle));
}
export function parseIdentityReceipt(value: unknown, raceId: string, attempt: IdentityAttempt) {
  const result = entryIdentityChangeResponseSchema.parse(value), request = attempt.request;
  const same = (a: typeof result.identity, b: typeof result.identity) =>
    a.givenName === b.givenName && a.familyName === b.familyName && a.organisationName === b.organisationName;
  if (result.raceId !== raceId || result.entryId !== attempt.entryId || result.requestId !== attempt.id ||
    result.classId !== request.expectedClassId || result.entryVersionBefore !== request.expectedEntryVersion ||
    result.snapshotVersionBefore !== request.expectedSnapshotVersion || !same(result.previousIdentity, request.expectedIdentity) ||
    !same(result.identity, request.identity)) throw new Error("Identity receipt mismatch");
  return result;
}
export function appendIdentityHistory(value: unknown, raceId: string, entryId: string, previous?: EntryIdentityHistoryResponse) {
  const page = entryIdentityHistoryResponseSchema.parse(value);
  if (page.raceId !== raceId || page.entryId !== entryId || (previous &&
    (previous.raceId !== raceId || previous.entryId !== entryId || previous.nextCursor === null))) throw new Error("Identity history mismatch");
  const items = [...(previous?.items ?? []), ...page.items];
  if (new Set(items.map((row) => row.requestId)).size !== items.length || items.some((row, i) =>
    i > 0 && row.entryVersionBefore >= items[i - 1]!.entryVersionBefore) ||
    (previous && page.nextCursor !== null && page.nextCursor === previous.nextCursor)) throw new Error("Identity history overlap");
  return { ...page, items };
}
