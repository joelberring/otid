import { entryRegistrationResponseSchema, type EntryRegistrationRequest } from "@o-tid/contracts";

export function parseRegistrationReceipt(value: unknown, raceId: string, attempt: { id: string; request: EntryRegistrationRequest }) {
  const result = entryRegistrationResponseSchema.parse(value), intent = attempt.request;
  // Minutstart utan angiven tid: en lottad klass ger en tid (PLAN.md steg 9), annars får löparen tiden vid lottningen (steg 24).
  const mayAssign = intent.expectedStartRule === "FIXED" && intent.fixedStartTime === null;
  if (result.requestId !== attempt.id || result.raceId !== raceId || result.classId !== intent.classId ||
    result.givenName !== intent.givenName || result.familyName !== intent.familyName ||
    result.organisationName !== intent.organisationName || result.cardNumber !== intent.cardNumber ||
    (result.startTimeAssigned && !mayAssign) ||
    (!result.startTimeAssigned && result.fixedStartTime !== intent.fixedStartTime)) {
    throw new Error("Registration receipt mismatch");
  }
  return result;
}
