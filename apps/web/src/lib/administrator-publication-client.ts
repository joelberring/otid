import { startListPublicationResponseSchema, type StartListPublicationRequest, type StartListPublicationContent } from "@o-tid/contracts";

export type AdministratorPublicationAttempt = { kind: "PUBLICATION"; id: string; request: StartListPublicationRequest; content: StartListPublicationContent | null };
export function parseAdministratorPublicationReceipt(value: unknown, raceId: string,
  attempt: Pick<AdministratorPublicationAttempt, "id" | "request">) {
  const result = startListPublicationResponseSchema.parse(value);
  if (result.raceId !== raceId || result.requestId !== attempt.id || result.action !== attempt.request.action ||
    result.revision !== attempt.request.expectedRevision + 1 || (attempt.request.action === "PUBLISH" &&
      (result.sourceHash !== attempt.request.expectedSourceHash || result.sourceSnapshotVersion !== attempt.request.expectedSnapshotVersion))) {
    throw new Error("Publication receipt mismatch");
  }
  return result;
}
