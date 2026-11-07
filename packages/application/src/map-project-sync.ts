import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { mapProjectSyncRequestSchema, type MapProjectSyncResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { decideEdit, editProblem, type EditResult, type RevisionEdit, type ServerObject } from "@o-tid/map-revision";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 beslut 4: synken. Ett anrop skickar klientens egna ändringar (i ordning) och hämtar allt som ändrats sedan
 * `since`. Projektets rad låses under anropet, så två synkar på samma projekt görs efter varandra och löpnumret blir en
 * obruten följd. Varje ändring avgörs för sig (`decideEdit`): gjord, redan gjord (samma id) eller krock. En krock ändrar inget,
 * loggas och skickas tillbaka med det som gäller, så att den senare får välja. En ändring vars referens inte hör till
 * projektets grundfil avvisas.
 *
 * Ett avslutat projekt tar inte emot ändringar; svaret kvitterar ingenting, så att klienten behåller sina ändringar (och kan
 * exportera dem) i stället för att tappa dem.
 */
const PULL_LIMIT = 2000;
/** Så många gjorda ändringar får ett projekt ha (skydd mot en klient som skickar i en evig slinga). */
export const MAP_PROJECT_MAX_EDITS = 500_000;

type ObjectRow = typeof schema.mapProjectObjects.$inferSelect;

const wire = (row: ObjectRow): ServerObject => ({ key: row.objectKey, ref: (row.ref ?? null) as ServerObject["ref"], state: row.state as ServerObject["state"],
  lastEditId: row.lastEditId, version: row.version, seq: row.seq, authorId: row.authorAccountId, at: row.editedAt.toISOString() });

/** Allt som ändrats sedan `since`, i löpnummerordning, högst `PULL_LIMIT` (då `more`). */
async function pull(tx: DbExecutor, projectId: string, since: number, seq: number): Promise<{ objects: ServerObject[]; seq: number; more: boolean }> {
  const rows = await tx.select().from(schema.mapProjectObjects)
    .where(and(eq(schema.mapProjectObjects.projectId, projectId), gt(schema.mapProjectObjects.seq, since)))
    .orderBy(asc(schema.mapProjectObjects.seq)).limit(PULL_LIMIT + 1);
  const more = rows.length > PULL_LIMIT;
  const kept = rows.slice(0, PULL_LIMIT);
  return { objects: kept.map(wire), seq: more ? kept[kept.length - 1]!.seq : seq, more };
}

const editIdOf = (edit: unknown) => {
  const value = (edit as { editId?: unknown } | null)?.editId;
  return typeof value === "string" ? value.slice(0, 64) : "";
};

export async function syncMapProject(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: MapProjectSyncResponse }> {
  const parsed = mapProjectSyncRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const wantsEdit = parsed.success && parsed.data.edits.length > 0;
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { clientId, since, edits } = parsed.data;
    const { project, accountId } = access;
    await tx.update(schema.mapProjectMembers).set({ lastSeenAt: now })
      .where(and(eq(schema.mapProjectMembers.projectId, project.id), eq(schema.mapProjectMembers.accountId, accountId)));
    const respond = async (results: EditResult[], seq: number) => {
      const pulled = await pull(tx, project.id, since, seq);
      return { status: "ok", response: { formatVersion: 1, seq: pulled.seq, status: project.status, results, objects: pulled.objects,
        more: pulled.more } } as const;
    };
    if (project.status !== "OPEN" || !wantsEdit) return respond([], project.seq);
    // Läsa får hämta men inte ändra.
    if (access.role === "READ") return { status: "forbidden" } as const;

    const results: EditResult[] = [];
    const valid: RevisionEdit[] = [];
    for (const edit of edits) {
      const problem = editProblem(edit);
      const ref = (edit as { ref?: { fileSha256?: unknown } | null }).ref;
      if (problem) results.push({ editId: editIdOf(edit), status: "REJECTED", reason: problem });
      else if (ref && ref.fileSha256 !== project.baseSha256) results.push({ editId: editIdOf(edit), status: "REJECTED", reason: "base" });
      else valid.push(edit as RevisionEdit);
    }
    let seq = project.seq;
    if (valid.length > 0) {
      const keys = [...new Set(valid.map(edit => edit.key))];
      const objects = schema.mapProjectObjects, log = schema.mapProjectEdits;
      const current = new Map((await tx.select().from(objects)
        .where(and(eq(objects.projectId, project.id), inArray(objects.objectKey, keys)))).map(row => [row.objectKey, row]));
      const applied = new Set((await tx.select({ editId: log.editId }).from(log)
        .where(and(eq(log.projectId, project.id), eq(log.status, "APPLIED"), inArray(log.editId, valid.map(edit => edit.editId)))))
        .map(row => row.editId));
      for (const edit of valid) {
        const row = current.get(edit.key);
        if (seq >= MAP_PROJECT_MAX_EDITS && !applied.has(edit.editId)) { results.push({ editId: edit.editId, status: "REJECTED", reason: "FULL" }); continue; }
        const decision = decideEdit(row, edit, applied.has(edit.editId));
        const entry = { id: randomUUID(), projectId: project.id, editId: edit.editId, objectKey: edit.key, baseEditId: edit.base, kind: edit.kind,
          state: edit.state, authorAccountId: accountId, clientId, editedAt: new Date(edit.at), receivedAt: now };
        if (decision === "DUPLICATE") {
          if (row) results.push({ editId: edit.editId, status: "DUPLICATE", object: wire(row) });
          continue;
        }
        if (decision === "CONFLICT") {
          await tx.insert(log).values({ ...entry, status: "CONFLICT", seq: null }).onConflictDoNothing();
          results.push({ editId: edit.editId, status: "CONFLICT", current: row ? wire(row) : null });
          continue;
        }
        seq += 1;
        const next: ObjectRow = { projectId: project.id, objectKey: edit.key, ref: edit.ref, state: edit.state, lastEditId: edit.editId,
          version: (row?.version ?? 0) + 1, seq, authorAccountId: accountId, editedAt: new Date(edit.at), receivedAt: now };
        await tx.insert(objects).values(next).onConflictDoUpdate({ target: [objects.projectId, objects.objectKey],
          set: { state: next.state, lastEditId: next.lastEditId, version: next.version, seq: next.seq, authorAccountId: next.authorAccountId,
            editedAt: next.editedAt, receivedAt: next.receivedAt } });
        // Ett tidigare krockat försök med samma id blir den gjorda ändringen.
        await tx.insert(log).values({ ...entry, status: "APPLIED", seq }).onConflictDoUpdate({ target: [log.projectId, log.editId],
          set: { status: "APPLIED", seq, receivedAt: now } });
        current.set(edit.key, next);
        applied.add(edit.editId);
        results.push({ editId: edit.editId, status: "APPLIED", object: wire(next) });
      }
      if (seq !== project.seq) await tx.update(schema.mapProjects).set({ seq }).where(eq(schema.mapProjects.id, project.id));
    }
    return respond(results, seq);
  });
}
