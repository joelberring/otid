import { and, desc, eq, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  COURSE_SETTING_DOCUMENT_MAX_BYTES, courseSettingDocumentSchema, courseSettingEditsRequestSchema, courseSettingEditsSavedSchema,
  courseSettingModeRequestSchema, courseSettingSuggestionCreateSchema, courseSettingSuggestionDecidedSchema, courseSettingSuggestionDecisionSchema,
  courseSettingSuggestionSchema, courseSettingSuggestionsSchema, type CourseSettingEditsSaved, type CourseSettingMode,
  type CourseSettingSuggestion, type CourseSettingSuggestionDecided, type CourseSettingSuggestions
} from "@o-tid/contracts";
import {
  replayEdits, touchedConflict, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds
} from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import {
  actor, actors, courseSettingRead, courseSettingWrite, documentBytes, loadRow, store, type Failure, type ReadProof, type Transaction
} from "./course-setting";
import type { RaceSessionProof } from "./race-session";

/**
 * Steg 66 (ADR-0181 beslut 2–4): åtgärder i stället för hela dokument, förslag och arbetssättet.
 *
 * Sparningen (`saveCourseSettingEditsAsAdmin`, EDIT) laddar dokumentet och spelar upp åtgärderna med paketets
 * `replayEdits`/`applyEdit` (ren TS, inga tunga jobb: en sparning är några åtgärder). Bygger de på en äldre version spelas de
 * upp på den aktuella, och det som någon annan ändrat sedan dess (`course_setting_change`) avvisas: den första vinner. En
 * sparning med samma `requestId` ger samma svar igen (nätet kan tappa svaret). Ny version och tidigare versioner som vid
 * vanligt sparande. Konfliktloggen får det som åtgärderna faktiskt ändrade (skillnaden mellan dokumenten, `diffTouches`),
 * så att också strukturändringar (lägga in, ta bort, gafflingar) krockar med andras.
 *
 * Förslag (`course_setting_suggestion`): den med SUGGEST skickar åtgärder mot en version med kommentar; den med EDIT
 * godkänner alla eller några (spelas upp på aktuell version på samma sätt) eller avböjer med kommentar.
 */
type Saved = { status: "ok"; response: CourseSettingEditsSaved; appliedIndexes: readonly number[] };

async function applyEdits(tx: Transaction, input: { raceId: string; actorId: string; now: Date; requestId: string; baseVersion: number;
  edits: readonly CourseSettingEdit[]; created?: readonly CreatedIds[] | undefined; skip?: ReadonlySet<number> | undefined })
  : Promise<Saved | { status: "not-found" | "invalid-request" | "too-large" }> {
  const { raceId, actorId, now, requestId } = input;
  const changes = schema.courseSettingChanges;
  const [done] = await tx.select({ result: changes.result }).from(changes).where(and(eq(changes.raceId, raceId), eq(changes.requestId, requestId)));
  if (done?.result) {
    const response = courseSettingEditsSavedSchema.parse(done.result.response);
    return { status: "ok", response, appliedIndexes: (done.result.appliedIndexes as number[] | undefined) ?? [] };
  }
  const current = await loadRow(tx, raceId);
  if (!current) return { status: "not-found" };
  if (input.baseVersion > current.version) return { status: "invalid-request" };
  const rebased = input.baseVersion !== current.version;
  let conflict: ReturnType<typeof touchedConflict> | undefined;
  if (rebased) {
    const rows = await tx.select({ touches: changes.touches }).from(changes).where(and(eq(changes.raceId, raceId), gt(changes.version, input.baseVersion)));
    const all = rows.length !== current.version - input.baseVersion || rows.some(row => row.touches === "ALL");
    conflict = touchedConflict(all ? "ALL" : rows.flatMap(row => row.touches as string[]));
  }
  const replay = replayEdits(current.document as unknown as CourseSettingDocument, input.edits, { created: input.created, conflict, skip: input.skip });
  const rejected = replay.rejected.map(row => ({ index: row.index, code: row.code, message: row.message.slice(0, 400) }));
  const appliedIndexes = replay.applied.map(row => row.index);
  const respond = (version: number, updatedAt: Date) => courseSettingEditsSavedSchema.parse({ formatVersion: 1, raceId, version,
    updatedAt: updatedAt.toISOString(), rebased, applied: replay.applied.length, rejected, idMap: replay.idMap });
  if (replay.applied.length === 0) return { status: "ok", response: respond(current.version, current.updatedAt), appliedIndexes };
  if (documentBytes(replay.document) > COURSE_SETTING_DOCUMENT_MAX_BYTES) return { status: "too-large" };
  const document = courseSettingDocumentSchema.safeParse(replay.document);
  if (!document.success) return { status: "invalid-request" };
  const saved = await store(tx, { raceId, actorId, now, current, kind: "SAVE", document: document.data, change: {
    // Det som varje åtgärd faktiskt ändrade (`diffTouches`, också banornas struktur), inte bara det åtgärden säger.
    touches: [...new Set(replay.applied.flatMap(row => row.touches))], requestId,
    result: version => ({ response: respond(version, now), appliedIndexes }) } });
  return { status: "ok", response: respond(saved.version, now), appliedIndexes };
}

/** Sparar åtgärder (EDIT). */
export async function saveCourseSettingEditsAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingEditsSaved }> {
  const parsed = courseSettingEditsRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    const result = await applyEdits(tx, { raceId, actorId, now, requestId: parsed.data.requestId, baseVersion: parsed.data.baseVersion,
      edits: parsed.data.edits as CourseSettingEdit[], created: parsed.data.created });
    return result.status === "ok" ? { status: "ok" as const, response: result.response } : result;
  });
}

/** Arbetssättet: "Huvudbanläggare" eller "Gemensamt" (bara admin). */
export async function setCourseSettingModeAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; mode: CourseSettingMode }> {
  const parsed = courseSettingModeRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "ADMIN", async (tx, raceId, actorId) => {
    const [row] = await tx.update(schema.courseSettings).set({ mode: parsed.data.mode }).where(eq(schema.courseSettings.raceId, raceId))
      .returning({ mode: schema.courseSettings.mode });
    if (!row) return { status: "not-found" as const };
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting", entityId: raceId, action: "COURSE_SETTING_MODE_CHANGED",
      actorKind: "USER_ACCOUNT", actorId, after: { mode: row.mode } });
    return { status: "ok" as const, mode: row.mode };
  });
}

type SuggestionRow = typeof schema.courseSettingSuggestions.$inferSelect;

async function suggestionDtos(tx: Transaction, rows: readonly SuggestionRow[]): Promise<CourseSettingSuggestion[]> {
  const names = await actors(tx, rows.flatMap(row => [row.createdBy, ...(row.decidedBy ? [row.decidedBy] : [])]));
  return rows.map(row => {
    const result = row.result as { version?: number | null; applied?: number[]; rejected?: unknown[] } | null;
    return courseSettingSuggestionSchema.parse({ id: row.id, baseVersion: row.baseVersion, edits: row.edits, created: row.created,
      comment: row.comment, status: row.status, createdAt: row.createdAt.toISOString(), createdBy: actor(names, row.createdBy),
      decidedAt: row.decidedAt?.toISOString() ?? null, decidedBy: row.decidedBy ? actor(names, row.decidedBy) : null,
      decisionComment: row.decisionComment, result: result ? { version: result.version ?? null, applied: result.applied ?? [],
        rejected: result.rejected ?? [] } : null });
  });
}

/** Förslagen, nyast först (COMMENT). */
export async function listCourseSettingSuggestionsAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingSuggestions }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const table = schema.courseSettingSuggestions;
    const rows = await tx.select().from(table).where(eq(table.raceId, raceId)).orderBy(desc(table.createdAt), desc(table.id)).limit(500);
    return { status: "ok" as const, response: courseSettingSuggestionsSchema.parse({ formatVersion: 1, raceId,
      suggestions: await suggestionDtos(tx, rows) }) };
  });
}

/** Ett nytt förslag (SUGGEST): åtgärder mot en version som finns. */
export async function createCourseSettingSuggestionAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "conflict" } | { status: "ok"; suggestion: CourseSettingSuggestion }> {
  const parsed = courseSettingSuggestionCreateSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "SUGGEST", async (tx, raceId, actorId) => {
    const table = schema.courseSettingSuggestions;
    const [existing] = await tx.select().from(table).where(eq(table.requestId, parsed.data.requestId));
    if (existing) {
      if (existing.raceId !== raceId || existing.createdBy !== actorId) return { status: "conflict" as const };
      return { status: "ok" as const, suggestion: (await suggestionDtos(tx, [existing]))[0]! };
    }
    const current = await loadRow(tx, raceId);
    if (!current) return { status: "not-found" as const };
    if (parsed.data.baseVersion > current.version) return { status: "invalid-request" as const };
    const [row] = await tx.insert(table).values({ id: randomUUID(), raceId, baseVersion: parsed.data.baseVersion, edits: parsed.data.edits,
      created: parsed.data.created, comment: parsed.data.comment, status: "OPEN", createdAt: now, createdBy: actorId,
      requestId: parsed.data.requestId }).returning();
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting_suggestion", entityId: row!.id,
      action: "COURSE_SETTING_SUGGESTED", actorKind: "USER_ACCOUNT", actorId, requestId: parsed.data.requestId,
      after: { baseVersion: parsed.data.baseVersion, edits: parsed.data.edits.length } });
    return { status: "ok" as const, suggestion: (await suggestionDtos(tx, [row!]))[0]! };
  });
}

/**
 * Godkänn (alla eller alla utom `skip`) eller avböj (EDIT). Godkända åtgärder spelas upp på aktuell version som en
 * sparning; det som inte går längre står i svaret. Helt godkänt = APPROVED, annars PARTIAL.
 */
export async function decideCourseSettingSuggestionAsAdmin(db: Database, input: RaceSessionProof & { suggestionId: string; request: unknown },
  now = new Date()): Promise<Failure | { status: "conflict" } | { status: "ok"; response: CourseSettingSuggestionDecided }> {
  const parsed = courseSettingSuggestionDecisionSchema.safeParse(input.request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(input.suggestionId)) return { status: "invalid-request" };
  const decision = parsed.data;
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    const table = schema.courseSettingSuggestions;
    const [row] = await tx.select().from(table).where(and(eq(table.id, input.suggestionId), eq(table.raceId, raceId))).for("update");
    if (!row) return { status: "not-found" as const };
    const answer = async (current: SuggestionRow, saved: CourseSettingEditsSaved | null) => ({ status: "ok" as const,
      response: courseSettingSuggestionDecidedSchema.parse({ formatVersion: 1, raceId, suggestion: (await suggestionDtos(tx, [current]))[0]!, saved }) });
    if (row.status !== "OPEN") {
      const result = row.result as { requestId?: string; saved?: CourseSettingEditsSaved | null } | null;
      return result?.requestId === decision.requestId ? answer(row, result.saved ?? null) : { status: "conflict" as const };
    }
    let status: SuggestionRow["status"] = "DECLINED";
    let saved: CourseSettingEditsSaved | null = null;
    let result: Record<string, unknown> = { requestId: decision.requestId, version: null, applied: [], rejected: [], saved: null };
    if (decision.decision === "APPROVE") {
      const skip = new Set((decision.skip ?? []).filter(index => index < row.edits.length));
      const applied = await applyEdits(tx, { raceId, actorId, now, requestId: decision.requestId, baseVersion: row.baseVersion,
        edits: row.edits as CourseSettingEdit[], created: row.created as CreatedIds[], skip });
      if (applied.status !== "ok") return applied;
      saved = applied.response;
      status = skip.size === 0 && saved.rejected.length === 0 ? "APPROVED" : "PARTIAL";
      result = { requestId: decision.requestId, version: saved.applied > 0 ? saved.version : null, applied: applied.appliedIndexes,
        rejected: saved.rejected, saved };
    }
    const [updated] = await tx.update(table).set({ status, decidedAt: now, decidedBy: actorId, decisionComment: decision.comment || null, result })
      .where(eq(table.id, row.id)).returning();
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting_suggestion", entityId: row.id,
      action: status === "DECLINED" ? "COURSE_SETTING_SUGGESTION_DECLINED" : "COURSE_SETTING_SUGGESTION_APPROVED", actorKind: "USER_ACCOUNT",
      actorId, requestId: decision.requestId, after: { status, version: result.version ?? null } });
    return answer(updated!, saved);
  });
}
