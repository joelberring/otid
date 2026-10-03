import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createOperationalBackupPmVerifier, PmObjectStorageError, readOperationalBackupPmObject } from "../src";

const item = {
  storeId: "10000000-0000-4000-8000-000000000002",
  key: "pm/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001",
  versionId: "version-a",
  sha256: createHash("sha256").update("backup-bytes").digest("hex"),
  byteLength: 12
};

describe("readOperationalBackupPmObject", () => {
  it("passes the exact version reference and verifies the returned bytes", async () => {
    const read = vi.fn().mockResolvedValue(Buffer.from("backup-bytes"));
    await expect(readOperationalBackupPmObject({ read }, item)).resolves.toEqual(Buffer.from("backup-bytes"));
    await expect(createOperationalBackupPmVerifier({ read }).verify(item)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledWith({ formatVersion: 1, ...item }, undefined);
  });

  it("fails closed for hash/length mismatch or a store failure", async () => {
    await expect(readOperationalBackupPmObject({ read: vi.fn().mockResolvedValue(Buffer.from("wrong-bytes")) }, item))
      .rejects.toBeInstanceOf(PmObjectStorageError);
    await expect(readOperationalBackupPmObject({ read: vi.fn().mockRejectedValue(new Error("secret")) }, item))
      .rejects.toBeInstanceOf(PmObjectStorageError);
  });

  it("rejects malformed references before calling the store", async () => {
    const read = vi.fn();
    await expect(readOperationalBackupPmObject({ read }, { ...item, versionId: "null" }))
      .rejects.toBeInstanceOf(PmObjectStorageError);
    expect(read).not.toHaveBeenCalled();
  });
});
