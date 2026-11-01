import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  COURSE_SETTING_NOTE_PHOTO_MAX_BYTES, courseSettingNoteCreateSchema, courseSettingNoteReplySchema, courseSettingNoteSchema,
  courseSettingNoteStatusSchema, courseSettingNotesSchema, type CourseSettingNote, type CourseSettingNotes
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { actor, actors, courseSettingRead, courseSettingWrite, type Failure, type ReadProof, type Transaction } from "./course-setting";
import type { RaceSessionProof } from "./race-session";

/**
 * Steg 66 (ADR-0181 beslut 1): notiser i banläggningen. De sparas för sig (`course_setting_note`, svar i
 * `course_setting_note_reply`), aldrig i dokumentet, så banpåtrycket, beskrivningarna, .ppen och överföringen till
 * tävlingen läser dem aldrig. Läsa och skriva kräver COMMENT. Fotot (högst 2 MB, förminskat i webbläsaren) hämtas för sig.
 */
type NoteRow = typeof schema.courseSettingNotes.$inferSelect;
const notes = schema.courseSettingNotes;
const replies = schema.courseSettingNoteReplies;

type NoteListRow = Omit<NoteRow, "photo"> & { photoBytes: number | null };

function targetOf(row: NoteListRow): CourseSettingNote["target"] {
  if (row.target === "POINT") return { kind: "POINT", at: { x: row.atX!, y: row.atY! } };
  if (row.target === "CONTROL") return { kind: "CONTROL", control: row.controlId! };
  if (row.target === "LEG") return { kind: "LEG", from: row.fromControlId!, to: row.toControlId! };
  return { kind: "COURSE", course: row.courseId! };
}

async function noteDtos(tx: Transaction, rows: readonly NoteListRow[]): Promise<CourseSettingNote[]> {
  const ids = rows.map(row => row.id);
  const answers = ids.length === 0 ? [] : await tx.select().from(replies).where(inArray(replies.noteId, ids))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  const names = await actors(tx, [...rows.flatMap(row => [row.createdBy, ...(row.resolvedBy ? [row.resolvedBy] : [])]),
    ...answers.map(answer => answer.createdBy)]);
  return rows.map(row => courseSettingNoteSchema.parse({ id: row.id, target: targetOf(row),
    at: row.atX !== null && row.atY !== null ? { x: row.atX, y: row.atY } : null, course: row.courseId, text: row.text, status: row.status,
    createdAt: row.createdAt.toISOString(), createdBy: actor(names, row.createdBy), resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy ? actor(names, row.resolvedBy) : null,
    photo: row.photoMediaType && row.photoBytes ? { mediaType: row.photoMediaType, bytes: row.photoBytes } : null,
    replies: answers.filter(answer => answer.noteId === row.id).map(answer => ({ id: answer.id, text: answer.text,
      createdAt: answer.createdAt.toISOString(), createdBy: actor(names, answer.createdBy) })) }));
}

const columns = {
  id: notes.id, raceId: notes.raceId, target: notes.target, atX: notes.atX, atY: notes.atY, controlId: notes.controlId,
  fromControlId: notes.fromControlId, toControlId: notes.toControlId, courseId: notes.courseId, text: notes.text, status: notes.status,
  createdAt: notes.createdAt, createdBy: notes.createdBy, resolvedAt: notes.resolvedAt, resolvedBy: notes.resolvedBy,
  photoMediaType: notes.photoMediaType, requestId: notes.requestId
};

async function selectNotes(tx: Transaction, raceId: string, id?: string): Promise<NoteListRow[]> {
  return tx.select({ ...columns, photoBytes: sql<number | null>`octet_length(${notes.photo})` }).from(notes)
    .where(and(eq(notes.raceId, raceId), id ? eq(notes.id, id) : undefined)).orderBy(asc(notes.createdAt), asc(notes.id)).limit(5000);
}

export async function listCourseSettingNotesAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingNotes }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => ({ status: "ok" as const,
    response: courseSettingNotesSchema.parse({ formatVersion: 1, raceId, notes: await noteDtos(tx, await selectNotes(tx, raceId)) }) }));
}

/** Bildens första byte stämmer med typen (inget annat sparas som foto). */
export function photoMatches(bytes: Uint8Array, mediaType: string): boolean {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mediaType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mediaType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mediaType === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return false;
}

export async function createCourseSettingNoteAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "conflict" } | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteCreateSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const photo = request.photo ? Buffer.from(request.photo.base64, "base64") : undefined;
  if (photo && (photo.byteLength === 0 || photo.byteLength > COURSE_SETTING_NOTE_PHOTO_MAX_BYTES)) return { status: "too-large" };
  if (photo && !photoMatches(photo, request.photo!.mediaType)) return { status: "invalid-request" };
  if (request.target.kind === "COURSE" && request.course !== null && request.course !== request.target.course) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "COMMENT", async (tx, raceId, actorId) => {
    const [existing] = await tx.select({ id: notes.id, raceId: notes.raceId, createdBy: notes.createdBy }).from(notes)
      .where(eq(notes.requestId, request.requestId));
    if (existing && (existing.raceId !== raceId || existing.createdBy !== actorId)) return { status: "conflict" as const };
    const id = existing?.id ?? randomUUID();
    if (!existing) {
      const target = request.target;
      const at = target.kind === "POINT" ? target.at : request.at;
      await tx.insert(notes).values({ id, raceId, target: target.kind, atX: at?.x ?? null, atY: at?.y ?? null,
        controlId: target.kind === "CONTROL" ? target.control : null, fromControlId: target.kind === "LEG" ? target.from : null,
        toControlId: target.kind === "LEG" ? target.to : null, courseId: target.kind === "COURSE" ? target.course : request.course,
        text: request.text, status: "OPEN", createdAt: now, createdBy: actorId, photo: photo ?? null,
        photoMediaType: photo ? request.photo!.mediaType : null, requestId: request.requestId });
    }
    const [note] = await noteDtos(tx, await selectNotes(tx, raceId, id));
    return { status: "ok" as const, note: note! };
  });
}

export async function replyCourseSettingNoteAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteReplySchema.safeParse(input.request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "COMMENT", async (tx, raceId, actorId) => {
    const [note] = await tx.select({ id: notes.id }).from(notes).where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId)));
    if (!note) return { status: "not-found" as const };
    const [existing] = await tx.select({ id: replies.id }).from(replies).where(eq(replies.requestId, parsed.data.requestId));
    if (!existing) await tx.insert(replies).values({ id: randomUUID(), noteId: note.id, raceId, text: parsed.data.text, createdAt: now,
      createdBy: actorId, requestId: parsed.data.requestId });
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, note.id));
    return { status: "ok" as const, note: dto! };
  });
}

/** Öppen eller klar (den som kommenterar får bocka av). */
export async function setCourseSettingNoteStatusAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteStatusSchema.safeParse(input.request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "COMMENT", async (tx, raceId, actorId) => {
    const done = parsed.data.status === "DONE";
    const [updated] = await tx.update(notes).set({ status: parsed.data.status, resolvedAt: done ? now : null, resolvedBy: done ? actorId : null })
      .where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId))).returning({ id: notes.id });
    if (!updated) return { status: "not-found" as const };
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, updated.id));
    return { status: "ok" as const, note: dto! };
  });
}

export async function readCourseSettingNotePhotoAsAdmin(db: Database, input: ReadProof & { noteId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; mediaType: string; photo: Buffer }> {
  if (!/^[0-9a-f-]{36}$/.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const [row] = await tx.select({ photo: notes.photo, mediaType: notes.photoMediaType }).from(notes)
      .where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId)));
    if (!row?.photo || !row.mediaType) return { status: "not-found" as const };
    return { status: "ok" as const, mediaType: row.mediaType, photo: row.photo };
  });
}
