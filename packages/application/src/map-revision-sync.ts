import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  MAP_REVISION_MAX_EDITS, mapRevisionSyncRequestSchema, type MapRevisionEditResultWire, type MapRevisionObjectWire, type MapRevisionSyncResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { decideEdit, editProblem, type RevisionEdit } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireRevision } from "./map-revisions";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0208 beslut 3–4: synken. Ett anrop skickar telefonens egna ändringar (i ordning) och hämtar allt som ändrats sedan
 * `since`. Revideringens rad låses under anropet, så två synkar på samma revidering görs efter varandra och löpnumret blir
 * en obruten följd. Varje ändring avgörs för sig (`decideEdit`): gjord, redan gjord (samma id) eller krock. En krock ändrar
 * inget, loggas och skickas tillbaka med det som gäller, så att den senare får välja.
 *
 * En avslutad revidering tar inte emot ändringar; svaret säger det och kvitterar ingenting, så att telefonen behåller sina
 * ändringar (och kan exportera dem) i stället för att tappa dem.
 */
export const MAP_REVISION_PULL_LIMIT = 2000;

type ObjectRow = typeof schema.mapRevisionObjects.$inferSelect;

const wire = (row: ObjectRow): MapRevisionObjectWire => ({ key: row.objectKey, ref: row.ref ?? null, state: row.state, lastEditId: row.lastEditId,
  version: row.version, seq: row.seq, authorId: row.authorAccountId, at: row.editedAt.toISOString() });

/** Allt som ändrats sedan `since`, i löpnummerordning, högst `MAP_REVISION_PULL_LIMIT` (då `more`). */
async function pull(tx: DbExecutor, revisionId: string, since: number, seq: number): Promise<{ objects: MapRevisionObjectWire[]; seq: number; more: boolean }> {
  const rows = await tx.select().from(schema.mapRevisionObjects)
    .where(and(eq(schema.mapRevisionObjects.revisionId, revisionId), gt(schema.mapRevisionObjects.seq, since)))
    .orderBy(asc(schema.mapRevisionObjects.seq)).limit(MAP_REVISION_PULL_LIMIT + 1);
  const more = rows.length > MAP_REVISION_PULL_LIMIT;
  const kept = rows.slice(0, MAP_REVISION_PULL_LIMIT);
  return { objects: kept.map(wire), seq: more ? kept[kept.length - 1]!.seq : seq, more };
}

export async function syncMapRevision(db: Database, input: ClubProof & { clubId: string; revisionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: MapRevisionSyncResponse & { more: boolean } }> {
  const parsed = mapRevisionSyncRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const { clientId, since, edits } = parsed.data;
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, edits.length > 0 ? "edit" : "view", true);
    if (access.status !== "ok") return access;
    const revision = access.revision;
    await tx.insert(schema.mapRevisionParticipants).values({ revisionId: revision.id, accountId: access.accountId, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: [schema.mapRevisionParticipants.revisionId, schema.mapRevisionParticipants.accountId], set: { lastSeenAt: now } });
    if (revision.status !== "OPEN" || edits.length === 0) {
      const pulled = await pull(tx, revision.id, since, revision.seq);
      return { status: "ok", response: { formatVersion: 1, seq: pulled.seq, status: revision.status, results: [], objects: pulled.objects, more: pulled.more } } as const;
    }

    const results: MapRevisionEditResultWire[] = [];
    const valid: RevisionEdit[] = [];
    for (const edit of edits) {
      const problem = editProblem(edit);
      const editId = typeof (edit as { editId?: unknown } | null)?.editId === "string" ? (edit as { editId: string }).editId : "";
      if (problem) results.push({ editId, status: "REJECTED", reason: problem });
      else valid.push(edit as RevisionEdit);
    }
    let seq = revision.seq;
    if (valid.length > 0) {
      const keys = [...new Set(valid.map(edit => edit.key))];
      const current = new Map((await tx.select().from(schema.mapRevisionObjects)
        .where(and(eq(schema.mapRevisionObjects.revisionId, revision.id), inArray(schema.mapRevisionObjects.objectKey, keys))))
        .map(row => [row.objectKey, row]));
      const applied = new Set((await tx.select({ editId: schema.mapRevisionEdits.editId }).from(schema.mapRevisionEdits)
        .where(and(eq(schema.mapRevisionEdits.revisionId, revision.id), eq(schema.mapRevisionEdits.status, "APPLIED"),
          inArray(schema.mapRevisionEdits.editId, valid.map(edit => edit.editId))))).map(row => row.editId));
      for (const edit of valid) {
        const row = current.get(edit.key);
        if (seq >= MAP_REVISION_MAX_EDITS && !applied.has(edit.editId)) { results.push({ editId: edit.editId, status: "REJECTED", reason: "FULL" }); continue; }
        const decision = decideEdit(row, edit, applied.has(edit.editId));
        const log = { id: randomUUID(), revisionId: revision.id, editId: edit.editId, objectKey: edit.key, baseEditId: edit.base, kind: edit.kind,
          state: edit.state, authorAccountId: access.accountId, clientId, editedAt: new Date(edit.at), receivedAt: now };
        if (decision === "DUPLICATE") {
          if (row) results.push({ editId: edit.editId, status: "DUPLICATE", object: wire(row) });
          continue;
        }
        if (decision === "CONFLICT") {
          await tx.insert(schema.mapRevisionEdits).values({ ...log, status: "CONFLICT", seq: null }).onConflictDoNothing();
          results.push({ editId: edit.editId, status: "CONFLICT", current: row ? wire(row) : null });
          continue;
        }
        seq += 1;
        const next: ObjectRow = { revisionId: revision.id, objectKey: edit.key, ref: edit.ref, state: edit.state, lastEditId: edit.editId,
          version: (row?.version ?? 0) + 1, seq, authorAccountId: access.accountId, editedAt: new Date(edit.at), receivedAt: now };
        await tx.insert(schema.mapRevisionObjects).values(next).onConflictDoUpdate({
          target: [schema.mapRevisionObjects.revisionId, schema.mapRevisionObjects.objectKey],
          set: { state: next.state, lastEditId: next.lastEditId, version: next.version, seq: next.seq, authorAccountId: next.authorAccountId,
            editedAt: next.editedAt, receivedAt: next.receivedAt } });
        // Ett tidigare krockat försök med samma id blir den gjorda ändringen.
        await tx.insert(schema.mapRevisionEdits).values({ ...log, status: "APPLIED", seq }).onConflictDoUpdate({
          target: [schema.mapRevisionEdits.revisionId, schema.mapRevisionEdits.editId], set: { status: "APPLIED", seq, receivedAt: now } });
        current.set(edit.key, next);
        applied.add(edit.editId);
        results.push({ editId: edit.editId, status: "APPLIED", object: wire(next) });
      }
      if (seq !== revision.seq) await tx.update(schema.mapRevisions).set({ seq }).where(eq(schema.mapRevisions.id, revision.id));
    }
    const pulled = await pull(tx, revision.id, since, seq);
    return { status: "ok", response: { formatVersion: 1, seq: pulled.seq, status: revision.status, results, objects: pulled.objects, more: pulled.more } } as const;
  });
}
