import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { decideEdit, editProblem, type EditResult, type RevisionEdit, type ServerObject } from "@o-tid/map-revision";
import type { MapProjectRow } from "./map-project-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 beslut 4: att göra ändringar i ett kartprojekt. Samma väg för synken (`map-project-sync.ts`) och för ett godkänt
 * förslag (`map-project-proposals.ts`, K1). Anroparen har låst projektets rad, så löpnumret blir en obruten följd. Varje
 * ändring avgörs för sig (`decideEdit`): gjord, redan gjord (samma id) eller krock. En krock ändrar inget och loggas.
 *
 * Vid ett godkänt förslag är författaren den som föreslog och loggen får förslaget och den som godkände (`proposal`).
 */
/** Så många gjorda ändringar får ett projekt ha (skydd mot en klient som skickar i en evig slinga). */
const MAP_PROJECT_MAX_EDITS = 500_000;

type ObjectRow = typeof schema.mapProjectObjects.$inferSelect;

export const wireObject = (row: ObjectRow): ServerObject => ({ key: row.objectKey, ref: (row.ref ?? null) as ServerObject["ref"],
  state: row.state as ServerObject["state"], lastEditId: row.lastEditId, version: row.version, seq: row.seq, authorId: row.authorAccountId,
  at: row.editedAt.toISOString() });

const editIdOf = (edit: unknown) => {
  const value = (edit as { editId?: unknown } | null)?.editId;
  return typeof value === "string" ? value.slice(0, 64) : "";
};

/** Ändringar ur en begäran: de giltiga och avvisningarna (fel i sig, eller en referens till en annan fil än grundfilen). */
export function validateEdits(edits: readonly unknown[], project: Pick<MapProjectRow, "baseSha256">)
  : { valid: RevisionEdit[]; rejected: EditResult[] } {
  const valid: RevisionEdit[] = [], rejected: EditResult[] = [];
  for (const edit of edits) {
    const problem = editProblem(edit);
    const ref = (edit as { ref?: { fileSha256?: unknown } | null }).ref;
    if (problem) rejected.push({ editId: editIdOf(edit), status: "REJECTED", reason: problem });
    else if (ref && ref.fileSha256 !== project.baseSha256) rejected.push({ editId: editIdOf(edit), status: "REJECTED", reason: "base" });
    else valid.push(edit as RevisionEdit);
  }
  return { valid, rejected };
}

/** Serverns nuvarande objekt för nycklarna. */
export async function currentObjects(tx: DbExecutor, projectId: string, keys: readonly string[]): Promise<Map<string, ObjectRow>> {
  if (keys.length === 0) return new Map();
  const objects = schema.mapProjectObjects;
  return new Map((await tx.select().from(objects)
    .where(and(eq(objects.projectId, projectId), inArray(objects.objectKey, [...new Set(keys)])))).map(row => [row.objectKey, row]));
}

/**
 * Gör ändringarna i ordning. Ger utfallet per ändring och projektets nya löpnummer (som också skrivs på projektet).
 * `project.seq` är löpnumret före anropet.
 */
export async function applyMapProjectEdits(tx: DbExecutor, input: { project: Pick<MapProjectRow, "id" | "seq">; authorId: string; clientId: string;
  edits: readonly RevisionEdit[]; now: Date; proposal?: { proposalId: string; acceptedBy: string } }): Promise<{ results: EditResult[]; seq: number }> {
  const { project, authorId, clientId, edits, now } = input;
  const results: EditResult[] = [];
  let seq = project.seq;
  if (edits.length === 0) return { results, seq };
  const objects = schema.mapProjectObjects, log = schema.mapProjectEdits;
  const current = await currentObjects(tx, project.id, edits.map(edit => edit.key));
  const applied = new Set((await tx.select({ editId: log.editId }).from(log)
    .where(and(eq(log.projectId, project.id), eq(log.status, "APPLIED"), inArray(log.editId, edits.map(edit => edit.editId)))))
    .map(row => row.editId));
  const via = input.proposal ? { proposalId: input.proposal.proposalId, acceptedBy: input.proposal.acceptedBy } : {};
  for (const edit of edits) {
    const row = current.get(edit.key);
    if (seq >= MAP_PROJECT_MAX_EDITS && !applied.has(edit.editId)) { results.push({ editId: edit.editId, status: "REJECTED", reason: "FULL" }); continue; }
    const decision = decideEdit(row, edit, applied.has(edit.editId));
    const entry = { id: randomUUID(), projectId: project.id, editId: edit.editId, objectKey: edit.key, baseEditId: edit.base, kind: edit.kind,
      state: edit.state, authorAccountId: authorId, clientId, editedAt: new Date(edit.at), receivedAt: now, ...via };
    if (decision === "DUPLICATE") {
      if (row) results.push({ editId: edit.editId, status: "DUPLICATE", object: wireObject(row) });
      continue;
    }
    if (decision === "CONFLICT") {
      await tx.insert(log).values({ ...entry, status: "CONFLICT", seq: null }).onConflictDoNothing();
      results.push({ editId: edit.editId, status: "CONFLICT", current: row ? wireObject(row) : null });
      continue;
    }
    seq += 1;
    const next: ObjectRow = { projectId: project.id, objectKey: edit.key, ref: edit.ref, state: edit.state, lastEditId: edit.editId,
      version: (row?.version ?? 0) + 1, seq, authorAccountId: authorId, editedAt: new Date(edit.at), receivedAt: now };
    await tx.insert(objects).values(next).onConflictDoUpdate({ target: [objects.projectId, objects.objectKey],
      set: { state: next.state, lastEditId: next.lastEditId, version: next.version, seq: next.seq, authorAccountId: next.authorAccountId,
        editedAt: next.editedAt, receivedAt: next.receivedAt } });
    // Ett tidigare krockat försök med samma id blir den gjorda ändringen.
    await tx.insert(log).values({ ...entry, status: "APPLIED", seq }).onConflictDoUpdate({ target: [log.projectId, log.editId],
      set: { status: "APPLIED", seq, receivedAt: now, ...via } });
    current.set(edit.key, next);
    applied.add(edit.editId);
    results.push({ editId: edit.editId, status: "APPLIED", object: wireObject(next) });
  }
  if (seq !== project.seq) await tx.update(schema.mapProjects).set({ seq }).where(eq(schema.mapProjects.id, project.id));
  return { results, seq };
}
