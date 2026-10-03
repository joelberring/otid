import { createHash } from "node:crypto";
import { operationalBackupPostgresDumpSchema, type OperationalBackupPostgresDump } from "@o-tid/contracts";

const errorMessage = "OPERATIONAL_BACKUP_POSTGRES_DUMP_INVALID";
const sourceKeys = new Set(["identity", "chunks", "expected"]);
const expectedDumpSchema = operationalBackupPostgresDumpSchema.pick({ sha256: true, byteLength: true }).strict();

/** A caller-owned, already-open dump stream. This adapter never opens a file or a database connection. */
export type OperationalBackupPostgresDumpSource = {
  identity: string;
  chunks: AsyncIterable<Uint8Array>;
  expected?: Pick<OperationalBackupPostgresDump, "sha256" | "byteLength">;
};

/** Deliberately reveals no source location, bytes, credentials, or stream error. */
export class OperationalBackupPostgresDumpError extends Error {
  constructor() {
    super(errorMessage);
    this.name = "OperationalBackupPostgresDumpError";
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function parseSource(input: unknown): {
  identity: unknown;
  chunks: AsyncIterable<unknown>;
  expected?: Pick<OperationalBackupPostgresDump, "sha256" | "byteLength">;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new OperationalBackupPostgresDumpError();
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !sourceKeys.has(key)) || !isAsyncIterable(record.chunks)) {
    throw new OperationalBackupPostgresDumpError();
  }
  if (record.expected === undefined) {
    return { identity: record.identity, chunks: record.chunks };
  }
  const expected = expectedDumpSchema.safeParse(record.expected);
  if (!expected.success) throw new OperationalBackupPostgresDumpError();
  return { identity: record.identity, chunks: record.chunks, expected: expected.data };
}

/**
 * Consumes one already-provided private dump stream and returns only its stable
 * identity, SHA-256 and byte length. It performs no filesystem, process,
 * PostgreSQL, MinIO, manifest, or write operation.
 */
export async function measureOperationalBackupPostgresDump(input: unknown): Promise<OperationalBackupPostgresDump> {
  try {
    const source = parseSource(input);
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of source.chunks) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > Number.MAX_SAFE_INTEGER - byteLength) {
        throw new OperationalBackupPostgresDumpError();
      }
      hash.update(chunk);
      byteLength += chunk.byteLength;
    }
    const measured = operationalBackupPostgresDumpSchema.parse({
      identity: source.identity,
      sha256: hash.digest("hex"),
      byteLength
    });
    if (source.expected !== undefined &&
      (source.expected.sha256 !== measured.sha256 || source.expected.byteLength !== measured.byteLength)) {
      throw new OperationalBackupPostgresDumpError();
    }
    return measured;
  } catch {
    throw new OperationalBackupPostgresDumpError();
  }
}
