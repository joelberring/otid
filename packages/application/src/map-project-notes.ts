import { and, asc, count, eq, sql } from "drizzle-orm";
import {
  MAP_PROJECT_NOTE_PHOTO_MAX_BYTES, mapProjectNoteCreateRequestSchema, mapProjectNoteUpdateRequestSchema, type MapProjectNoteList,
  type MapProjectNoteView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { photoMatches } from "./course-setting-notes";
import { mapProjectAllows, requireMapProject } from "./map-project-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 (K3, tillägget om rekningen): notiser i kartprojektet. Alla medlemmar ser dem; den som får föreslå eller mer
 * (projektet öppet) skriver dem; den som skrev notisen och ägarna markerar den klar och tar bort den. Id:t skapas i
 * telefonen, så samma notis två gånger blir en (kön utan nät). Fotot kontrolleras mot sin typ, som banläggningens notiser.
 */
const notes = schema.mapProjectNotes;
/** Så många notiser får ett projekt ha. */
const MAX_NOTES = 5000;

type NoteRow = Omit<typeof notes.$inferSelect, "photo"> & { photoBytes: number | null; name: string | null };
const columns = { id: notes.id, projectId: notes.projectId, accountId: notes.accountId, atX: notes.atX, atY: notes.atY, objectKey: notes.objectKey,
  text: notes.text, photoMediaType: notes.photoMediaType, status: notes.status, createdAt: notes.createdAt, resolvedAt: notes.resolvedAt,
  resolvedBy: notes.resolvedBy, photoBytes: sql<number | null>`octet_length(${notes.photo})`, name: schema.userAccounts.displayName };

const view = (row: NoteRow, viewer: string): MapProjectNoteView => ({ noteId: row.id, at: { x: row.atX, y: row.atY }, objectKey: row.objectKey,
  text: row.text, photo: row.photoMediaType && row.photoBytes ? { mediaType: row.photoMediaType, bytes: Number(row.photoBytes) } : null,
  status: row.status, account: { accountId: row.accountId, name: row.name }, own: row.accountId === viewer, createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null });

async function oneNote(tx: DbExecutor, projectId: string, noteId: string): Promise<NoteRow | undefined> {
  const [row] = await tx.select(columns).from(notes).leftJoin(schema.userAccounts, eq(schema.userAccounts.id, notes.accountId))
    .where(and(eq(notes.id, noteId), eq(notes.projectId, projectId)));
  return row;
}

export async function listMapProjectNotes(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapProjectNoteList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select(columns).from(notes).leftJoin(schema.userAccounts, eq(schema.userAccounts.id, notes.accountId))
      .where(eq(notes.projectId, access.project.id)).orderBy(asc(notes.createdAt), asc(notes.id)).limit(MAX_NOTES);
    return { status: "ok", list: { formatVersion: 1, notes: rows.map(row => view(row, access.accountId)) } } as const;
  });
}

/** Ny notis (föreslå eller mer, projektet öppet). Idempotent på notisens id. */
export async function createMapProjectNote(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "too-large" } | { status: "created"; replayed: boolean; note: MapProjectNoteView }> {
  const parsed = mapProjectNoteCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { noteId, at, objectKey, text, photo } = parsed.data;
    const [prior] = await tx.select({ projectId: notes.projectId, accountId: notes.accountId }).from(notes).where(eq(notes.id, noteId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.accountId !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, note: view((await oneNote(tx, access.project.id, noteId))!, access.accountId) } as const;
    }
    const bytes = photo ? Buffer.from(photo.base64, "base64") : undefined;
    if (bytes && (bytes.byteLength === 0 || bytes.byteLength > MAP_PROJECT_NOTE_PHOTO_MAX_BYTES)) return { status: "too-large" } as const;
    if (bytes && !photoMatches(bytes, photo!.mediaType)) return { status: "invalid-request" } as const;
    const [total] = await tx.select({ value: count() }).from(notes).where(eq(notes.projectId, access.project.id));
    if (Number(total?.value ?? 0) >= MAX_NOTES) return { status: "conflict" } as const;
    await tx.insert(notes).values({ id: noteId, projectId: access.project.id, accountId: access.accountId, atX: at.x, atY: at.y,
      objectKey: objectKey ?? null, text, photo: bytes ?? null, photoMediaType: bytes ? photo!.mediaType : null, status: "OPEN", createdAt: now });
    return { status: "created", replayed: false, note: view((await oneNote(tx, access.project.id, noteId))!, access.accountId) } as const;
  });
}

/** Den som skrev notisen eller ägarna. */
async function ownOrOwner(tx: Parameters<typeof requireMapProject>[0], input: ClubProof & { projectId: string; noteId: string }, now: Date) {
  const access = await requireMapProject(tx, input, now, "view", true);
  if (access.status !== "ok") return access;
  if (!UUID_PATTERN.test(input.noteId)) return { status: "not-found" } as const;
  const row = await oneNote(tx, access.project.id, input.noteId);
  if (!row) return { status: "not-found" } as const;
  if (row.accountId !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
  return { status: "ok" as const, access, row };
}

/** Klar eller öppen igen. */
export async function updateMapProjectNote(db: Database, input: ClubProof & { projectId: string; noteId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; note: MapProjectNoteView }> {
  const parsed = mapProjectNoteUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const found = await ownOrOwner(tx, input, now);
    if (found.status !== "ok") return found;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const done = parsed.data.status === "DONE";
    await tx.update(notes).set({ status: parsed.data.status, resolvedAt: done ? now : null, resolvedBy: done ? found.access.accountId : null })
      .where(eq(notes.id, found.row.id));
    return { status: "ok", note: view((await oneNote(tx, found.access.project.id, found.row.id))!, found.access.accountId) } as const;
  });
}

export async function deleteMapProjectNote(db: Database, input: ClubProof & { projectId: string; noteId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  return db.transaction(async tx => {
    const found = await ownOrOwner(tx, input, now);
    if (found.status !== "ok") return found;
    await tx.delete(notes).where(eq(notes.id, found.row.id));
    return { status: "deleted" } as const;
  });
}

export async function readMapProjectNotePhoto(db: Database, input: ClubProof & { projectId: string; noteId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; mediaType: string; photo: Buffer }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.noteId)) return { status: "not-found" } as const;
    const [row] = await tx.select({ photo: notes.photo, mediaType: notes.photoMediaType }).from(notes)
      .where(and(eq(notes.id, input.noteId), eq(notes.projectId, access.project.id)));
    if (!row?.photo || !row.mediaType) return { status: "not-found" } as const;
    return { status: "ok", mediaType: row.mediaType, photo: row.photo } as const;
  });
}
