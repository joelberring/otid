import { Buffer } from "node:buffer";
import { and, desc, eq, lt } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryIdentityHistoryResponseSchema, type EntryIdentityHistoryResponse } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Cursor = { v: 1; kind: "entry-identity-history"; raceId: string; entryId: string; beforeEntryVersion: number };
function parseCursor(value: string | undefined, raceId: string, entryId: string): Cursor | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error("Invalid cursor");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("Invalid cursor");
  const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("Invalid cursor");
  const record = decoded as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "beforeEntryVersion,entryId,kind,raceId,v" ||
    record.v !== 1 || record.kind !== "entry-identity-history" || record.raceId !== raceId || record.entryId !== entryId ||
    typeof record.beforeEntryVersion !== "number" || !Number.isSafeInteger(record.beforeEntryVersion) ||
    record.beforeEntryVersion < 1 || record.beforeEntryVersion > 2_147_483_647) throw new Error("Invalid cursor");
  return { v: 1, kind: "entry-identity-history", raceId, entryId, beforeEntryVersion: record.beforeEntryVersion };
}

export type EntryIdentityHistoryResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: EntryIdentityHistoryResponse };

export async function listEntryIdentityHistoryAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & {
    entryId: string; limit: number; cursor?: string;
  }, now = new Date()
): Promise<EntryIdentityHistoryResult> {
  let cursor: Cursor | undefined;
  try {
    if (!uuid.test(input.raceId) || !uuid.test(input.entryId) || !Number.isSafeInteger(input.limit) ||
      input.limit < 1 || input.limit > 50) throw new Error("Invalid request");
    cursor = parseCursor(input.cursor, input.raceId, input.entryId);
  } catch { return { status: "invalid-request" }; }
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability: "CHANGE_ENTRY_IDENTITY"
    }, now);
    if (auth.status !== "authenticated") return auth;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, auth.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, race.id), eq(schema.entries.id, input.entryId)));
    if (!entry) return { status: "not-found" } as const;
    const journal = schema.entryIdentityChangeRequests;
    const rows = await tx.select({ requestId: journal.requestId, classId: journal.classId,
      previousIdentity: journal.previousIdentity, identity: journal.identity,
      entryVersionBefore: journal.entryVersionBefore, entryVersionAfter: journal.entryVersionAfter,
      snapshotVersionBefore: journal.snapshotVersionBefore, snapshotVersionAfter: journal.snapshotVersionAfter,
      changedAt: journal.changedAt
    }).from(journal).where(and(eq(journal.raceId, race.id), eq(journal.entryId, entry.id),
      cursor ? lt(journal.entryVersionBefore, cursor.beforeEntryVersion) : undefined))
      .orderBy(desc(journal.entryVersionBefore)).limit(input.limit + 1);
    const page = rows.slice(0, input.limit), last = page.at(-1);
    const next: Cursor | undefined = rows.length > input.limit && last ? {
      v: 1, kind: "entry-identity-history", raceId: race.id, entryId: entry.id, beforeEntryVersion: last.entryVersionBefore
    } : undefined;
    return { status: "ok", response: entryIdentityHistoryResponseSchema.parse({
      formatVersion: 1, raceId: race.id, entryId: entry.id,
      items: page.map(row => ({ ...row, changedAt: row.changedAt.toISOString() })),
      nextCursor: next ? Buffer.from(JSON.stringify(next), "utf8").toString("base64url") : null
    }) } as const;
  }, { isolationLevel: "repeatable read" });
}
