import { entryRegistrationResponseSchema, type EntryRegistrationRequest } from "@o-tid/contracts";

export function parseRegistrationReceipt(value: unknown, raceId: string, attempt: { id: string; request: EntryRegistrationRequest }) {
  const result = entryRegistrationResponseSchema.parse(value), intent = attempt.request;
  if (result.requestId !== attempt.id || result.raceId !== raceId || result.classId !== intent.classId ||
    result.givenName !== intent.givenName || result.familyName !== intent.familyName ||
    result.organisationName !== intent.organisationName || result.cardNumber !== intent.cardNumber ||
    result.fixedStartTime !== intent.fixedStartTime || result.snapshotVersionBefore !== intent.expectedSnapshotVersion ||
    ((intent.assignedStartSlot ?? null) === null ? result.assignedStartSlot !== null : result.assignedStartSlot === null ||
      result.assignedStartSlot.drawRequestId !== intent.assignedStartSlot?.drawRequestId ||
      result.assignedStartSlot.sourceHash !== intent.assignedStartSlot?.sourceHash ||
      result.assignedStartSlot.fixedStartTime !== intent.assignedStartSlot?.fixedStartTime)) {
    throw new Error("Registration receipt mismatch");
  }
  return result;
}
