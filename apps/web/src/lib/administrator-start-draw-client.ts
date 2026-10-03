import { classStartDrawResponseSchema, type ClassStartDrawRequest, type ClassStartDrawPreviewResponse } from "@o-tid/contracts";

export type AdministratorDrawAttempt = { kind: "DRAW"; id: string; request: ClassStartDrawRequest; preview: ClassStartDrawPreviewResponse };

export function parseAdministratorDrawReceipt(value: unknown, raceId: string,
  attempt: Pick<AdministratorDrawAttempt, "id" | "request">) {
  const receipt = classStartDrawResponseSchema.parse(value);
  if (receipt.raceId !== raceId || receipt.requestId !== attempt.id || receipt.classId !== attempt.request.classId ||
    receipt.sourceHash !== attempt.request.sourceHash || receipt.snapshotVersionBefore !== attempt.request.expectedSnapshotVersion ||
    JSON.stringify(receipt.parameters) !== JSON.stringify(attempt.request.parameters)) throw new Error("Draw receipt mismatch");
  return receipt;
}
