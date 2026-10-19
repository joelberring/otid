import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  classRemovalRequestSchema, classRemovalResponseSchema, courseRemovalRequestSchema, courseRemovalResponseSchema,
  entryRemovalRequestSchema, entryRemovalResponseSchema, prefixedUuidPattern,
  type ClassRemovalResponse, type CourseRemovalResponse, type EntryRemovalResponse, type RemovalOutcome
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { PurgeProtectedError, purgeRows } from "./purge";
import { bumpReadoutPackageVersion, type DbExecutor } from "./snapshot";

/**
 * Ta bort deltagare, klass och bana och stryk deltagare (PLAN.md steg 27). Bara administratören. En borttagning tar
 * raden och det som bara hör till den (journaler, brickkoppling, lottad plats) med samma följning av främmande nycklar
 * som tävlingens borttagning (`purgeRows`); resultatrevisioner, avläsningar, råa meddelanden och fastställanden är
 * skyddade och stoppar borttagningen. En borttagen deltagares lottade tid blir vakant igen. Allt får en auditpost
 * med begärans id; samma begäran igen ger samma kvitto.
 */
const PROTECTED = ["result_revision", "card_readout", "raw_device_message", "result_finalization", "radio_punch",
  "unknown_readout_resolution", "device_ingest_outcome"] as const;

type Input = RaceSessionProof & { idempotencyKey: string | null; request: unknown };
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
type Removed<T> = Failure | { status: "saved"; response: T };
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Principal = { raceId: string; accountId: string };

class Blocked extends Error {
  constructor(readonly outcome: Extract<RemovalOutcome, { outcome: "BLOCKED" }>) { super(outcome.blocker); }
}

const blocked = (blocker: Extract<RemovalOutcome, { outcome: "BLOCKED" }>["blocker"], extra: { count?: number; names?: string[] } = {}) =>
  new Blocked({ outcome: "BLOCKED", blocker, ...extra });

/** Gemensam ram: idempotensnyckel, roll, tidigare kvitto (auditposten) och ett hinder som rullar tillbaka allt. */
async function removal<R extends { requestId: string }>(db: Database, input: Input, prefix: string,
  parse: (value: unknown) => R | undefined, entityType: string, entityIdOf: (request: R) => string,
  run: (tx: Tx, principal: Principal, request: R) => Promise<{ action: string; outcome: RemovalOutcome; before: Record<string, unknown> }>,
  now: Date): Promise<Failure | { status: "saved"; request: R; result: RemovalOutcome; replayed: boolean; raceId: string }> {
  const request = parse(input.request);
  if (!request || typeof input.idempotencyKey !== "string" || !prefixedUuidPattern(prefix).test(input.idempotencyKey) ||
    input.idempotencyKey !== `${prefix}:${request.requestId}`) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
      if (auth.status !== "authenticated") return auth;
      const principal = auth.principal;
      await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, principal.raceId)).for("update");
      const [earlier] = await tx.select({ entityId: schema.auditEvents.entityId, entityType: schema.auditEvents.entityType,
        after: schema.auditEvents.after }).from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.raceId, principal.raceId), eq(schema.auditEvents.requestId, request.requestId))).limit(1);
      if (earlier) {
        const outcome = (earlier.after as { outcome?: unknown } | null)?.outcome;
        if (earlier.entityType !== entityType || earlier.entityId !== entityIdOf(request) || (outcome !== "DELETED" && outcome !== "STRUCK")) {
          return { status: "conflict" } as const;
        }
        return { status: "saved", request, result: { outcome }, replayed: true, raceId: principal.raceId } as const;
      }
      const done = await run(tx, principal, request);
      await tx.insert(schema.auditEvents).values({ raceId: principal.raceId, entityType, entityId: entityIdOf(request),
        action: done.action, actorKind: "USER_ACCOUNT", actorId: principal.accountId, requestId: request.requestId,
        before: done.before, after: { outcome: done.outcome.outcome }, createdAt: now });
      await bumpReadoutPackageVersion(tx, principal.raceId);
      return { status: "saved", request, result: done.outcome, replayed: false, raceId: principal.raceId } as const;
    });
  } catch (error) {
    if (error instanceof Blocked) return { status: "saved", request, result: error.outcome, replayed: false, raceId: input.raceId };
    if (error instanceof NotFound) return { status: "not-found" };
    if (error instanceof Conflict) return { status: "conflict" };
    throw error;
  }
}

class NotFound extends Error {}
class Conflict extends Error {}

/** En anmälan har ett resultat om den har en resultatrevision (avläst, beslut, ej start från Eventor m.m.). */
async function hasResult(tx: DbExecutor, raceId: string, entryId: string): Promise<boolean> {
  const [row] = await tx.select({ value: count() }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId)));
  return (row?.value ?? 0) > 0;
}

/** Tar bort med `purgeRows`; skulle en skyddad tabell beröras blir det ett hinder och inget tas bort. */
async function purgeOrBlock(tx: Tx, root: "entry" | "class" | "course", id: string, extra: readonly string[],
  onProtected: () => Blocked): Promise<void> {
  try { await purgeRows(tx, root, [id], { protect: [...PROTECTED, ...extra] }); }
  catch (error) { if (error instanceof PurgeProtectedError) throw onProtected(); throw error; }
}

export async function removeEntryAsAdmin(db: Database, input: Input, now = new Date()): Promise<Removed<EntryRemovalResponse>> {
  const result = await removal(db, input, "entry-removal", value => {
    const parsed = entryRemovalRequestSchema.safeParse(value); return parsed.success ? parsed.data : undefined;
  }, "entry", request => request.entryId, async (tx, principal, request) => {
    const [entry] = await tx.select().from(schema.entries)
      .where(and(eq(schema.entries.id, request.entryId), eq(schema.entries.raceId, principal.raceId), isNull(schema.entries.struckAt)))
      .for("update");
    if (!entry) throw new NotFound();
    if (entry.version !== request.expectedEntryVersion) throw new Conflict();
    if (entry.teamId !== null) throw blocked("RELAY_RUNNER");
    const before = { givenName: entry.givenName, familyName: entry.familyName, classId: entry.classId, version: entry.version };
    if (request.mode === "STRIKE") {
      // Stryk: dold i alla listor, brickan släpps så att den kan kopplas till någon annan. Revisionerna står kvar.
      await tx.update(schema.entries).set({ struckAt: now, version: entry.version + 1 })
        .where(eq(schema.entries.id, entry.id));
      await tx.update(schema.cardAssignments).set({ active: false })
        .where(and(eq(schema.cardAssignments.entryId, entry.id), eq(schema.cardAssignments.active, true)));
      return { action: "ENTRY_STRUCK_BY_ADMIN", outcome: { outcome: "STRUCK" }, before };
    }
    if (await hasResult(tx, principal.raceId, entry.id)) throw blocked("HAS_RESULT");
    // Den lottade platsen blir vakant igen: lottningens rad tas med anmälan och läggs tillbaka utan löpare.
    const slots = await tx.select().from(schema.startDrawSlots).where(eq(schema.startDrawSlots.entryId, entry.id));
    await purgeOrBlock(tx, "entry", entry.id, ["team"], () => blocked("HAS_RESULT"));
    if (slots.length > 0) await tx.insert(schema.startDrawSlots).values(slots.map(slot => ({ ...slot, entryId: null })));
    return { action: "ENTRY_DELETED_BY_ADMIN", outcome: { outcome: "DELETED" }, before };
  }, now);
  if (result.status !== "saved") return result;
  return { status: "saved", response: entryRemovalResponseSchema.parse({ formatVersion: 1, replayed: result.replayed,
    requestId: result.request.requestId, raceId: result.raceId, savedAt: now.toISOString(), request: result.request, result: result.result }) };
}

export async function removeClassAsAdmin(db: Database, input: Input, now = new Date()): Promise<Removed<ClassRemovalResponse>> {
  const result = await removal(db, input, "class-removal", value => {
    const parsed = classRemovalRequestSchema.safeParse(value); return parsed.success ? parsed.data : undefined;
  }, "class", request => request.classId, async (tx, principal, request) => {
    const [raceClass] = await tx.select().from(schema.classes)
      .where(and(eq(schema.classes.id, request.classId), eq(schema.classes.raceId, principal.raceId))).for("update");
    if (!raceClass) throw new NotFound();
    const [active] = await tx.select({ value: count() }).from(schema.entries)
      .where(and(eq(schema.entries.classId, raceClass.id), isNull(schema.entries.struckAt)));
    if ((active?.value ?? 0) > 0) throw blocked("CLASS_HAS_ENTRIES", { count: active!.value });
    const [struck] = await tx.select({ value: count() }).from(schema.entries)
      .where(and(eq(schema.entries.classId, raceClass.id), isNotNull(schema.entries.struckAt)));
    const [teams] = await tx.select({ value: count() }).from(schema.teams).where(eq(schema.teams.classId, raceClass.id));
    if ((struck?.value ?? 0) > 0 || (teams?.value ?? 0) > 0) throw blocked("CLASS_HAS_HISTORY");
    await purgeOrBlock(tx, "class", raceClass.id, ["entry", "team"], () => blocked("CLASS_HAS_HISTORY"));
    return { action: "CLASS_DELETED_BY_ADMIN", outcome: { outcome: "DELETED" }, before: { name: raceClass.name } };
  }, now);
  if (result.status !== "saved") return result;
  return { status: "saved", response: classRemovalResponseSchema.parse({ formatVersion: 1, replayed: result.replayed,
    requestId: result.request.requestId, raceId: result.raceId, savedAt: now.toISOString(), request: result.request, result: result.result }) };
}

export async function removeCourseAsAdmin(db: Database, input: Input, now = new Date()): Promise<Removed<CourseRemovalResponse>> {
  const result = await removal(db, input, "course-removal", value => {
    const parsed = courseRemovalRequestSchema.safeParse(value); return parsed.success ? parsed.data : undefined;
  }, "course", request => request.courseId, async (tx, principal, request) => {
    const [course] = await tx.select().from(schema.courses)
      .where(and(eq(schema.courses.id, request.courseId), eq(schema.courses.raceId, principal.raceId))).for("update");
    if (!course) throw new NotFound();
    const versions = (await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, course.id))).map(row => row.id);
    if (versions.length > 0) {
      const users = await tx.select({ name: schema.classes.name }).from(schema.classes)
        .where(and(eq(schema.classes.raceId, principal.raceId), inArray(schema.classes.courseVersionId, versions)))
        .orderBy(sql`lower(${schema.classes.name})`);
      if (users.length > 0) throw blocked("COURSE_USED_BY_CLASS", { names: users.map(row => row.name) });
      const [results] = await tx.select({ value: count() }).from(schema.resultRevisions)
        .where(inArray(schema.resultRevisions.courseVersionId, versions));
      if ((results?.value ?? 0) > 0) throw blocked("COURSE_HAS_RESULTS");
    }
    await purgeOrBlock(tx, "course", course.id, ["class", "entry"], () => blocked("COURSE_HAS_RESULTS"));
    return { action: "COURSE_DELETED_BY_ADMIN", outcome: { outcome: "DELETED" }, before: { name: course.name } };
  }, now);
  if (result.status !== "saved") return result;
  return { status: "saved", response: courseRemovalResponseSchema.parse({ formatVersion: 1, replayed: result.replayed,
    requestId: result.request.requestId, raceId: result.raceId, savedAt: now.toISOString(), request: result.request, result: result.result }) };
}
