import { describe, expect, it } from "vitest";
import { createEventorEntryImportAttempt } from "./eventor-entry-import-admin";
import type { EventorEntryImportPreviewResponse } from "@o-tid/contracts";

const preview: EventorEntryImportPreviewResponse = {
  formatVersion: 2, grantId: "10000000-0000-4000-8000-000000000001", environment: "testeventor-se",
  eventClassesSourceHash: "a".repeat(64), entriesSourceHash: "b".repeat(64), entriesCount: 2,
  sourceClasses: [{ externalClassId: "D21", name: "D21", entryCount: 2 }],
  targetClasses: [{ classId: "10000000-0000-4000-8000-000000000002", name: "D21" }],
};
const requestId = "10000000-0000-4000-8000-000000000003";

describe("EventorEntryImportAdmin mapping", () => {
  it("requires a complete unique mapping and creates the stable retry key", () => {
    const attempt = createEventorEntryImportAttempt(preview, { D21: preview.targetClasses[0]!.classId }, requestId);
    expect(attempt?.key).toBe(`eventor-entry-import:${requestId}`);
    expect(attempt?.request.mappings).toEqual([{ externalClassId: "D21", classId: preview.targetClasses[0]!.classId }]);
    expect(createEventorEntryImportAttempt(preview, {}, requestId)).toBeUndefined();
  });

  it("rejects duplicate target assignment", () => {
    const two = { ...preview, sourceClasses: [...preview.sourceClasses, { externalClassId: "H21", name: "H21", entryCount: 0 }], entriesCount: 2 };
    expect(createEventorEntryImportAttempt(two, { D21: preview.targetClasses[0]!.classId, H21: preview.targetClasses[0]!.classId }, requestId)).toBeUndefined();
  });
});
