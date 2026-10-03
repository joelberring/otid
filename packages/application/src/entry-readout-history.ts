import { Buffer } from "node:buffer";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryReadoutHistoryResponseSchema, serverResultSummarySchema,
  type EntryReadoutHistoryResponse } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Cursor = { v: 1; kind: "entry-readouts"; raceId: string; entryId: string; receivedAt: string; readoutId: string };

function parseCursor(value: string | undefined, raceId: string, entryId: string): Cursor | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error("invalid cursor");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("invalid cursor");
  const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("invalid cursor");
  const record = decoded as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "entryId,kind,raceId,readoutId,receivedAt,v" ||
    record.v !== 1 || record.kind !== "entry-readouts" || record.raceId !== raceId || record.entryId !== entryId ||
    typeof record.readoutId !== "string" || !uuid.test(record.readoutId) || typeof record.receivedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(record.receivedAt) ||
    !Number.isFinite(Date.parse(record.receivedAt)) ||
    new Date(record.receivedAt).toISOString() !== `${record.receivedAt.slice(0, 23)}Z`) {
    throw new Error("invalid cursor");
  }
  return { v: 1, kind: "entry-readouts", raceId, entryId, receivedAt: record.receivedAt, readoutId: record.readoutId };
}

export type EntryReadoutHistoryResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: EntryReadoutHistoryResponse };

export async function listEntryReadoutHistoryAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & {
    entryId: string; limit: number; cursor?: string;
  }, now = new Date()
): Promise<EntryReadoutHistoryResult> {
  let cursor: Cursor | undefined;
  try {
    if (!uuid.test(input.raceId) || !uuid.test(input.entryId) || !Number.isSafeInteger(input.limit) ||
      input.limit < 1 || input.limit > 50) throw new Error("invalid request");
    cursor = parseCursor(input.cursor, input.raceId, input.entryId);
  } catch { return { status: "invalid-request" }; }
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability: "VIEW_READOUT_RESULT_HISTORY"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    const [entry] = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName })
      .from(schema.entries).where(and(eq(schema.entries.raceId, race.id), eq(schema.entries.id, input.entryId)));
    if (!entry) return { status: "not-found" } as const;
    const identity = { id: entry.id, displayName: `${entry.givenName} ${entry.familyName}` };

    // Choose the original binding among ALL entries before applying the requested entry filter.
    const original = tx.select({ entryId: schema.resultRevisions.entryId })
      .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, race.id),
        eq(schema.resultRevisions.readoutId, schema.cardReadouts.id), eq(schema.resultRevisions.cause, "CARD_READOUT")))
      .orderBy(asc(schema.resultRevisions.revision), asc(schema.resultRevisions.id)).limit(1).as("original_binding");
    const seek = cursor === undefined ? undefined : or(
      lt(schema.rawDeviceMessages.serverReceivedAt, sql`${cursor.receivedAt}::timestamptz`),
      and(eq(schema.rawDeviceMessages.serverReceivedAt, sql`${cursor.receivedAt}::timestamptz`), lt(schema.cardReadouts.id, cursor.readoutId))
    );
    const rows = await tx.select({ id: schema.cardReadouts.id, readAt: schema.cardReadouts.readAt,
      cardNumber: schema.cardReadouts.cardNumber,
      receivedAt: sql<string>`to_char(${schema.rawDeviceMessages.serverReceivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      serverResult: schema.deviceIngestOutcomes.serverResult })
      .from(schema.cardReadouts)
      .innerJoin(schema.rawDeviceMessages, eq(schema.rawDeviceMessages.id, schema.cardReadouts.rawMessageId))
      .innerJoinLateral(original, sql`true`)
      .leftJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.cardReadouts.rawMessageId))
      .where(and(eq(schema.cardReadouts.raceId, race.id), eq(original.entryId, entry.id), seek))
      .orderBy(desc(schema.rawDeviceMessages.serverReceivedAt), desc(schema.cardReadouts.id)).limit(input.limit + 1);
    const page = rows.slice(0, input.limit), last = page.at(-1);
    const next: Cursor | undefined = rows.length > input.limit && last ? {
      v: 1, kind: "entry-readouts", raceId: race.id, entryId: entry.id,
      receivedAt: last.receivedAt, readoutId: last.id
    } : undefined;
    return { status: "ok", response: entryReadoutHistoryResponseSchema.parse({
      formatVersion: 1, raceId: race.id, entry: identity,
      page: { formatVersion: 10, raceId: race.id,
        items: page.map(row => {
          const assessment = row.serverResult === null ? null : serverResultSummarySchema.parse(row.serverResult);
          return { id: row.id, readAt: row.readAt.toISOString(), cardNumber: row.cardNumber, entry: identity,
            firstServerAssessment: assessment === null ? null : {
              status: assessment.status, reason: assessment.reason, engineVersion: assessment.engineVersion,
              snapshotVersion: assessment.snapshotVersion,
              courseVersionId: assessment.status === "UNKNOWN_CARD" ? null : assessment.courseVersionId
            } };
        }), nextCursor: next ? Buffer.from(JSON.stringify(next), "utf8").toString("base64url") : null }
    }) } as const;
  }, { isolationLevel: "repeatable read" });
}
