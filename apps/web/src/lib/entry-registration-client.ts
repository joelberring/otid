import { entryRegistrationResponseSchema, type EntryRegistrationRequest } from "@o-tid/contracts";

export function parseRegistrationReceipt(value: unknown, raceId: string, attempt: { id: string; request: EntryRegistrationRequest }) {
  const result = entryRegistrationResponseSchema.parse(value), intent = attempt.request;
  // Fast start utan angiven tid: appen gav en tid från klassens lottning (PLAN.md steg 9).
  const assigned = intent.expectedStartRule === "FIXED" && intent.fixedStartTime === null;
  if (result.requestId !== attempt.id || result.raceId !== raceId || result.classId !== intent.classId ||
    result.givenName !== intent.givenName || result.familyName !== intent.familyName ||
    result.organisationName !== intent.organisationName || result.cardNumber !== intent.cardNumber ||
    result.snapshotVersionBefore !== intent.expectedSnapshotVersion || result.startTimeAssigned !== assigned ||
    (!assigned && result.fixedStartTime !== intent.fixedStartTime)) {
    throw new Error("Registration receipt mismatch");
  }
  return result;
}
