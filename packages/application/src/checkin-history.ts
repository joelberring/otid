import { Buffer } from "node:buffer";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { checkinHistoryResponseSchema, StartCheckinOperationSchema,
  type CheckinHistoryResponse } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { validateStoredStartCheckinReceipt } from "./start-checkin-sync";
import { allowsStartCheckinSourceAction } from "./start-checkin-source-action";
import { reviewedCheckinRequests } from "./checkin-conflict-review-journal";
import { UUID_PATTERN as uuid } from "./serialization";

type Input = RaceSessionProof & { entryId: string; limit: number; cursor?: string };
type Cursor = { v: 1; kind: "checkin-history"; raceId: string; entryId: string; receivedAt: string; requestId: string };
function cursor(value: string | undefined, raceId: string, entryId: string): Cursor | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("Invalid cursor encoding");
  const record: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error();
  const r = record as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "entryId,kind,raceId,receivedAt,requestId,v" || r.v !== 1 || r.kind !== "checkin-history" || r.raceId !== raceId || r.entryId !== entryId || typeof r.requestId !== "string" || !uuid.test(r.requestId) || typeof r.receivedAt !== "string") throw new Error();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.receivedAt) ||
      !Number.isFinite(Date.parse(r.receivedAt)) || new Date(r.receivedAt).toISOString() !== `${r.receivedAt.slice(0, 23)}Z`) throw new Error("Invalid cursor time");
  return r as Cursor;
}
export type CheckinHistoryResult = { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" } | { status: "ok"; response: CheckinHistoryResponse };
export async function listCheckinHistoryAsAdmin(db: Database, input: Input, now = new Date()): Promise<CheckinHistoryResult> {
  let c: Cursor | undefined;
  try { if (!uuid.test(input.raceId) || !uuid.test(input.entryId) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error(); c = cursor(input.cursor, input.raceId, input.entryId); } catch { return { status: "invalid-request" }; }
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { sessionToken: input.sessionToken, raceId: input.raceId, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    if (auth.principal.raceId !== input.raceId) return { status: "forbidden" } as const;
    const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, auth.principal.raceId)));
    if (!entry) return { status: "not-found" } as const;
    const seek = c ? or(lt(schema.startCheckinOperations.receivedAt, sql`${c.receivedAt}::timestamptz`), and(eq(schema.startCheckinOperations.receivedAt, sql`${c.receivedAt}::timestamptz`), lt(schema.startCheckinOperations.requestId, c.requestId))) : undefined;
    const rows = await tx.select({ op: schema.startCheckinOperations, label: schema.startCheckinDevices.label,
      role: schema.startCheckinDevices.role, deviceActor: schema.startCheckinDevices.actorAccountId,
      deviceRace: schema.startCheckinDevices.raceId,
      exactReceivedAt: sql<string>`to_char(${schema.startCheckinOperations.receivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    }).from(schema.startCheckinOperations)
      .innerJoin(schema.startCheckinDevices, eq(schema.startCheckinDevices.id, schema.startCheckinOperations.deviceId))
      .where(and(eq(schema.startCheckinOperations.raceId, auth.principal.raceId), eq(schema.startCheckinOperations.entryId, entry.id), seek))
      .orderBy(desc(schema.startCheckinOperations.receivedAt), desc(schema.startCheckinOperations.requestId)).limit(input.limit + 1);
    const page = rows.slice(0, input.limit), last = page.at(-1);
    const allOperations = await tx.select().from(schema.startCheckinOperations).where(and(eq(schema.startCheckinOperations.raceId, auth.principal.raceId), eq(schema.startCheckinOperations.entryId, entry.id))).limit(100_001);
    if (allOperations.length > 100_000) throw new Error("Checkin history projection too large");
    const operationById = new Map(allOperations.map(operation => [operation.requestId, operation]));
    const reviewByConflict = await reviewedCheckinRequests(tx, auth.principal.raceId, operationById, entry.id);
    const next = rows.length > input.limit && last ? { v: 1 as const, kind: "checkin-history" as const,
      raceId: auth.principal.raceId, entryId: entry.id, receivedAt: last.exactReceivedAt, requestId: last.op.requestId } : null;
    const mapped = page.map(row => {
      const op = StartCheckinOperationSchema.parse(row.op.intent);
      const receipt = validateStoredStartCheckinReceipt(row.op);
      if (row.op.actorAccountId !== row.deviceActor || row.deviceRace !== input.raceId ||
          !allowsStartCheckinSourceAction(row.role, op.action)) throw new Error("Ogiltig journalkälla");
      return { requestId: op.requestId, observedAt: op.observedAt, receivedAt: receipt.receivedAt,
        source: row.role, sourceLabel: row.label, action: op.action, effect: receipt.effect,
        reviewed: receipt.effect.kind === "CONFLICT" ? reviewByConflict.get(op.requestId) ?? null : null };
    });
    return { status: "ok", response: checkinHistoryResponseSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId, entryId: entry.id, rows: mapped, nextCursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null }) };
  }, { isolationLevel: "repeatable read" });
}
