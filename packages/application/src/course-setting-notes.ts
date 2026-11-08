import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  COURSE_SETTING_NOTE_PHOTO_MAX_BYTES, courseSettingNoteCreateSchema, courseSettingNoteReplySchema, courseSettingNoteSchema,
  courseSettingNoteEditSchema, courseSettingNoteStatusSchema, courseSettingNotesSchema, sketchCenter, type CourseSettingNote, type CourseSettingNotes
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { actor, actors, courseSettingRead, courseSettingWrite, loadRow, type Failure, type ReadProof, type Transaction } from "./course-setting";
import { courseSettingAllows, type CourseSettingPrincipal } from "./course-setting-access";
import type { RaceSessionProof } from "./race-session";

/**
 * Steg 66 (ADR-0181 beslut 1): notiser i banläggningen. De sparas för sig (`course_setting_note`, svar i
 * `course_setting_note_reply`), aldrig i dokumentet, så banpåtrycket, beskrivningarna, .ppen och överföringen till
 * tävlingen läser dem aldrig. Läsa och skriva kräver COMMENT. Fotot (högst 2 MB, förminskat i webbläsaren) hämtas för sig.
 *
 * ADR-0181 beslut 8: en notis kan ha en ritning (target SKETCH) och vara ett kartfel. Den som skrev en notis eller ett
 * svar och den som får ändra (EDIT) kan ta bort den; svaren och fotot försvinner med notisen. Kartritaren (MAP) ser bara
 * kartfelen (utan bana och foto, som kan visa en kontrollplats), svarar och markerar dem klara, men skriver inga notiser.
 *
 * ADR-0214: kartritaren kan också svara med en länk utan konto (`course-setting-map-link.ts`); svaret har då inget konto
 * utan kartritarens namn och eventuellt ett besked ("Åtgärdat i kartan"/"Inte åtgärdat").
 *
 * Översynen 2026-11-02: en ny notis på en kontroll, sträcka eller bana som inte finns i dokumentet avvisas (409). Telefonens
 * kö skickas efter ändringarna med id översatta (`remapQueuedItem`), så en notis på en kontroll som skapades utan nät
 * hamnar på rätt kontroll eller får ett besked, aldrig på någon annans kontroll med samma lokala id.
 */

/** Kontrollerna och banan som en notis pekar på finns i banläggningens dokument. */
export async function noteTargetExists(tx: Transaction, raceId: string,
  refs: { readonly controls: readonly string[]; readonly courses: readonly string[] }): Promise<boolean> {
  if (refs.controls.length === 0 && refs.courses.length === 0) return true;
  const row = await loadRow(tx, raceId);
  const document = row?.document as { controls?: Record<string, unknown>; courses?: { id: string }[] } | undefined;
  if (!document) return false;
  return refs.controls.every(id => Object.hasOwn(document.controls ?? {}, id)) &&
    refs.courses.every(id => (document.courses ?? []).some(course => course.id === id));
}
type NoteRow = typeof schema.courseSettingNotes.$inferSelect;
const notes = schema.courseSettingNotes;
const replies = schema.courseSettingNoteReplies;
const edits = schema.courseSettingNoteEdits;

type NoteListRow = Omit<NoteRow, "photo"> & { photoBytes: number | null };

function targetOf(row: NoteListRow): CourseSettingNote["target"] {
  if (row.target === "POINT") return { kind: "POINT", at: { x: row.atX!, y: row.atY! } };
  if (row.target === "CONTROL") return { kind: "CONTROL", control: row.controlId! };
  if (row.target === "LEG") return { kind: "LEG", from: row.fromControlId!, to: row.toControlId! };
  if (row.target === "SKETCH") return { kind: "SKETCH", shapes: row.sketch as never };
  return { kind: "COURSE", course: row.courseId! };
}

async function noteDtos(tx: Transaction, rows: readonly NoteListRow[]): Promise<CourseSettingNote[]> {
  const ids = rows.map(row => row.id);
  const answers = ids.length === 0 ? [] : await tx.select().from(replies).where(inArray(replies.noteId, ids))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  const names = await actors(tx, [...rows.flatMap(row => [row.createdBy, ...(row.resolvedBy ? [row.resolvedBy] : [])]),
    ...answers.flatMap(answer => answer.createdBy ? [answer.createdBy] : [])]);
  return rows.map(row => courseSettingNoteSchema.parse({ id: row.id, target: targetOf(row), kind: row.kind,
    at: row.atX !== null && row.atY !== null ? { x: row.atX, y: row.atY } : null, course: row.courseId, text: row.text, status: row.status,
    createdAt: row.createdAt.toISOString(), createdBy: actor(names, row.createdBy), resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy ? actor(names, row.resolvedBy) : null,
    photo: row.photoMediaType && row.photoBytes ? { mediaType: row.photoMediaType, bytes: row.photoBytes } : null,
    replies: answers.filter(answer => answer.noteId === row.id).map(answer => ({ id: answer.id, text: answer.text,
      createdAt: answer.createdAt.toISOString(),
      // ADR-0214: kartritaren svarade med länken (utan konto), med namnet hen skrev och eventuellt ett besked.
      ...(answer.mapLinkId !== null ? { createdBy: null, mapMaker: { name: answer.authorName }, ...(answer.verdict ? { verdict: answer.verdict } : {}) }
        : { createdBy: actor(names, answer.createdBy!) }),
      ...(answer.editedAt ? { editedAt: answer.editedAt.toISOString() } : {}) })),
    ...(row.editedAt ? { editedAt: row.editedAt.toISOString() } : {}) }));
}

const columns = {
  id: notes.id, raceId: notes.raceId, target: notes.target, atX: notes.atX, atY: notes.atY, controlId: notes.controlId,
  fromControlId: notes.fromControlId, toControlId: notes.toControlId, courseId: notes.courseId, text: notes.text, status: notes.status,
  createdAt: notes.createdAt, createdBy: notes.createdBy, resolvedAt: notes.resolvedAt, resolvedBy: notes.resolvedBy,
  photoMediaType: notes.photoMediaType, requestId: notes.requestId, kind: notes.kind, sketch: notes.sketch, editedAt: notes.editedAt,
  resolvedMapLinkId: notes.resolvedMapLinkId
};

const isMapError = (row: Pick<NoteListRow, "kind" | "target">) => row.kind === "MAP_ERROR" && (row.target === "POINT" || row.target === "SKETCH");
const mapMaker = (principal: CourseSettingPrincipal) => principal.level === "MAP";
/** Det kartritaren ser av ett kartfel: ingen bana och inget foto. */
const forMapMaker = (note: CourseSettingNote): CourseSettingNote => ({ ...note, course: null, photo: null });

/** Notisen finns i tävlingen och den som skriver får nå den (kartritaren bara kartfel). */
async function reachable(tx: Transaction, raceId: string, noteId: string, principal: CourseSettingPrincipal)
  : Promise<{ status: "not-found" } | { status: "forbidden" } | { status: "ok" }> {
  const [note] = await tx.select({ kind: notes.kind, target: notes.target }).from(notes).where(and(eq(notes.id, noteId), eq(notes.raceId, raceId)));
  if (!note) return { status: "not-found" };
  return mapMaker(principal) && !isMapError(note) ? { status: "forbidden" } : { status: "ok" };
}

async function selectNotes(tx: Transaction, raceId: string, id?: string): Promise<NoteListRow[]> {
  return tx.select({ ...columns, photoBytes: sql<number | null>`octet_length(${notes.photo})` }).from(notes)
    .where(and(eq(notes.raceId, raceId), id ? eq(notes.id, id) : undefined)).orderBy(asc(notes.createdAt), asc(notes.id)).limit(5000);
}

export async function listCourseSettingNotesAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingNotes }> {
  return courseSettingRead(db, input, now, async (tx, raceId, principal) => {
    const rows = await selectNotes(tx, raceId);
    const list = mapMaker(principal) ? (await noteDtos(tx, rows.filter(isMapError))).map(forMapMaker) : await noteDtos(tx, rows);
    return { status: "ok" as const, response: courseSettingNotesSchema.parse({ formatVersion: 1, raceId, notes: list }) };
  }, "MAP");
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
  return courseSettingWrite(db, input, now, "COMMENT", (tx, raceId, actorId) => insertCourseSettingNote(tx, raceId, actorId, request, photo, now));
}

/**
 * En ny notis (idempotent på `requestId`) när behörigheten redan är prövad: av sessionen ovan eller av AI-kopplingen
 * (AI-banläggningsassistenten, ägaren 2026-11-08). Kontrollen, sträckan eller banan måste finnas i dokumentet.
 */
export async function insertCourseSettingNote(tx: Transaction, raceId: string, actorId: string,
  request: ReturnType<typeof courseSettingNoteCreateSchema.parse>, photo: Buffer | undefined, now: Date)
  : Promise<{ status: "conflict" } | { status: "ok"; note: CourseSettingNote }> {
  {
    const [existing] = await tx.select({ id: notes.id, raceId: notes.raceId, createdBy: notes.createdBy }).from(notes)
      .where(eq(notes.requestId, request.requestId));
    if (existing && (existing.raceId !== raceId || existing.createdBy !== actorId)) return { status: "conflict" as const };
    const id = existing?.id ?? randomUUID();
    if (!existing) {
      const target = request.target;
      const controls = target.kind === "CONTROL" ? [target.control] : target.kind === "LEG" ? [target.from, target.to] : [];
      const course = target.kind === "COURSE" ? target.course : request.course;
      if (!await noteTargetExists(tx, raceId, { controls, courses: course ? [course] : [] })) return { status: "conflict" as const };
      const at = target.kind === "POINT" ? target.at : target.kind === "SKETCH" ? sketchCenter(target.shapes) : request.at;
      await tx.insert(notes).values({ id, raceId, target: target.kind, kind: request.kind ?? "COURSE_SETTING",
        sketch: target.kind === "SKETCH" ? target.shapes : null, atX: at?.x ?? null, atY: at?.y ?? null,
        controlId: target.kind === "CONTROL" ? target.control : null, fromControlId: target.kind === "LEG" ? target.from : null,
        toControlId: target.kind === "LEG" ? target.to : null, courseId: target.kind === "COURSE" ? target.course : request.course,
        text: request.text, status: "OPEN", createdAt: now, createdBy: actorId, photo: photo ?? null,
        photoMediaType: photo ? request.photo!.mediaType : null, requestId: request.requestId });
    }
    const [note] = await noteDtos(tx, await selectNotes(tx, raceId, id));
    return { status: "ok" as const, note: note! };
  }
}

export async function replyCourseSettingNoteAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteReplySchema.safeParse(input.request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "MAP", async (tx, raceId, actorId, principal) => {
    const access = await reachable(tx, raceId, input.noteId, principal);
    if (access.status !== "ok") return access;
    const [existing] = await tx.select({ id: replies.id }).from(replies).where(eq(replies.requestId, parsed.data.requestId));
    if (!existing) await tx.insert(replies).values({ id: randomUUID(), noteId: input.noteId, raceId, text: parsed.data.text, createdAt: now,
      createdBy: actorId, requestId: parsed.data.requestId });
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, input.noteId));
    return { status: "ok" as const, note: mapMaker(principal) ? forMapMaker(dto!) : dto! };
  });
}

/** Öppen eller klar (den som kommenterar får bocka av). */
export async function setCourseSettingNoteStatusAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteStatusSchema.safeParse(input.request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "MAP", async (tx, raceId, actorId, principal) => {
    const access = await reachable(tx, raceId, input.noteId, principal);
    if (access.status !== "ok") return access;
    const done = parsed.data.status === "DONE";
    const [updated] = await tx.update(notes).set({ status: parsed.data.status, resolvedAt: done ? now : null, resolvedBy: done ? actorId : null,
      resolvedMapLinkId: null })
      .where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId))).returning({ id: notes.id });
    if (!updated) return { status: "not-found" as const };
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, updated.id));
    return { status: "ok" as const, note: mapMaker(principal) ? forMapMaker(dto!) : dto! };
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

const idPattern = /^[0-9a-f-]{36}$/;

/** Tar bort notisen med svar och foto: den som skrev den eller den som får ändra. En redan borttagen ger not-found. */
export async function deleteCourseSettingNoteAsAdmin(db: Database, input: RaceSessionProof & { noteId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; id: string }> {
  if (!idPattern.test(input.noteId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "COMMENT", async (tx, raceId, actorId, principal) => {
    const [row] = await tx.select({ id: notes.id, createdBy: notes.createdBy }).from(notes)
      .where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId)));
    if (!row) return { status: "not-found" as const };
    if (row.createdBy !== actorId && !courseSettingAllows(principal, "EDIT")) return { status: "forbidden" as const };
    await tx.delete(edits).where(and(eq(edits.noteId, row.id), eq(edits.raceId, raceId)));
    await tx.delete(replies).where(and(eq(replies.noteId, row.id), eq(replies.raceId, raceId)));
    await tx.delete(notes).where(eq(notes.id, row.id));
    return { status: "ok" as const, id: row.id };
  });
}

/** Tar bort ett svar: den som skrev det eller den som får ändra. Ger notisen utan svaret. */
export async function deleteCourseSettingNoteReplyAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; replyId: string },
  now = new Date()): Promise<Failure | { status: "ok"; note: CourseSettingNote }> {
  if (!idPattern.test(input.noteId) || !idPattern.test(input.replyId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "MAP", async (tx, raceId, actorId, principal) => {
    const access = await reachable(tx, raceId, input.noteId, principal);
    if (access.status !== "ok") return access;
    const [row] = await tx.select({ id: replies.id, createdBy: replies.createdBy }).from(replies)
      .where(and(eq(replies.id, input.replyId), eq(replies.noteId, input.noteId), eq(replies.raceId, raceId)));
    if (!row) return { status: "not-found" as const };
    if (row.createdBy !== actorId && !courseSettingAllows(principal, "EDIT")) return { status: "forbidden" as const };
    await tx.delete(edits).where(eq(edits.replyId, row.id));
    await tx.delete(replies).where(eq(replies.id, row.id));
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, input.noteId));
    return dto ? { status: "ok" as const, note: mapMaker(principal) ? forMapMaker(dto) : dto } : { status: "not-found" as const };
  });
}

/**
 * ADR-0214 beslut 9: redigera en egen notis eller ett eget svar (bara den som skrev det, inte ens den med EDIT, och aldrig
 * kartritarens svar med länken). Den tidigare texten sparas i `course_setting_note_edit` och notisen eller svaret får
 * `edited_at`. Bygger redigeringen på en text som någon annan har ändrat sedan dess blir det 409 och inget skrivs.
 */
export async function editCourseSettingNoteAsAdmin(db: Database, input: RaceSessionProof & { noteId: string; replyId?: string; request: unknown },
  now = new Date()): Promise<Failure | { status: "conflict" } | { status: "ok"; note: CourseSettingNote }> {
  const parsed = courseSettingNoteEditSchema.safeParse(input.request);
  if (!parsed.success || !idPattern.test(input.noteId) || (input.replyId !== undefined && !idPattern.test(input.replyId))) {
    return { status: "invalid-request" };
  }
  return courseSettingWrite(db, input, now, input.replyId ? "MAP" : "COMMENT", async (tx, raceId, actorId, principal) => {
    const access = await reachable(tx, raceId, input.noteId, principal);
    if (access.status !== "ok") return access;
    const table = input.replyId ? replies : notes;
    const id = input.replyId ?? input.noteId;
    const [row] = input.replyId
      ? await tx.select({ text: replies.text, createdBy: replies.createdBy }).from(replies)
        .where(and(eq(replies.id, input.replyId), eq(replies.noteId, input.noteId), eq(replies.raceId, raceId))).for("update")
      : await tx.select({ text: notes.text, createdBy: notes.createdBy }).from(notes)
        .where(and(eq(notes.id, input.noteId), eq(notes.raceId, raceId))).for("update");
    if (!row) return { status: "not-found" as const };
    if (row.createdBy !== actorId) return { status: "forbidden" as const };
    if (row.text !== parsed.data.text) {
      if (row.text !== parsed.data.expectedText) return { status: "conflict" as const };
      await tx.insert(edits).values({ id: randomUUID(), raceId, noteId: input.noteId, replyId: input.replyId ?? null, previousText: row.text,
        editedAt: now, editedBy: actorId });
      await tx.update(table).set({ text: parsed.data.text, editedAt: now }).where(eq(table.id, id));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting_note", entityId: input.noteId,
        action: input.replyId ? "COURSE_SETTING_NOTE_REPLY_EDITED" : "COURSE_SETTING_NOTE_EDITED", actorKind: "USER_ACCOUNT", actorId,
        after: input.replyId ? { replyId: input.replyId } : {}, createdAt: now });
    }
    const [dto] = await noteDtos(tx, await selectNotes(tx, raceId, input.noteId));
    return dto ? { status: "ok" as const, note: mapMaker(principal) ? forMapMaker(dto) : dto } : { status: "not-found" as const };
  });
}
