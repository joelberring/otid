import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { measureOperationalBackupPostgresDump, OperationalBackupPostgresDumpError } from "../src";

const dumpBytes = Buffer.from("synthetic-private-postgres-dump");
const sha256 = createHash("sha256").update(dumpBytes).digest("hex");

async function* chunks(...values: unknown[]): AsyncGenerator<unknown> {
  yield* values;
}

async function expectInvalid(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(OperationalBackupPostgresDumpError);
    expect(error).toMatchObject({
      name: "OperationalBackupPostgresDumpError",
      message: "OPERATIONAL_BACKUP_POSTGRES_DUMP_INVALID"
    });
    return;
  }
  throw new Error("Expected an invalid dump source to be rejected");
}

describe("measureOperationalBackupPostgresDump", () => {
  it("measures an already-open dump stream across arbitrary chunk boundaries", async () => {
    await expect(measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks(dumpBytes.subarray(0, 5), dumpBytes.subarray(5, 17), dumpBytes.subarray(17)),
      expected: { sha256, byteLength: dumpBytes.byteLength }
    })).resolves.toEqual({ identity: "backup-run-2026-09-22", sha256, byteLength: dumpBytes.byteLength });
  });

  it("rejects a mismatched expected hash or length without exposing the private source", async () => {
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks(dumpBytes),
      expected: { sha256: "0".repeat(64), byteLength: dumpBytes.byteLength }
    }));
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks(dumpBytes),
      expected: { sha256, byteLength: dumpBytes.byteLength + 1 }
    }));
  });

  it("rejects empty, malformed and failed sources with the same secret-free error", async () => {
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks()
    }));
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks("not-bytes")
    }));
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: chunks(dumpBytes),
      path: "/private/never-accepted.dump"
    }));
    await expectInvalid(() => measureOperationalBackupPostgresDump({
      identity: "backup-run-2026-09-22",
      chunks: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error("private-stream-failure");
            }
          };
        }
      }
    }));
  });
});
