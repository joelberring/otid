import { describe, expect, it } from "vitest";
import { pmDocumentStorageReceiptSchema } from "../src";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const receipt = { formatVersion: 1, uploadId: id, raceId: id, storedAt: "2026-09-07T10:00:00.000Z", replayed: false };
describe("PM durable storage receipt", () => {
  it("acknowledges only a persisted upload identity and time", () => {
    expect(pmDocumentStorageReceiptSchema.parse(receipt)).toEqual(receipt);
  });
  it("cannot claim scan approval or expose object storage details", () => {
    for (const extra of [{ status: "READY" }, { key: "private" }, { versionId: "v1" }, { scanStatus: "CLEAN" }]) {
      expect(pmDocumentStorageReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false);
    }
    expect(pmDocumentStorageReceiptSchema.safeParse({ ...receipt, storedAt: "wrong" }).success).toBe(false);
  });
});
