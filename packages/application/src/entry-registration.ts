import { and, asc, count, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryRegistrationClassesResponseSchema, entryRegistrationRequestSchema,
  entryRegistrationIdempotencyKeySchema, entryRegistrationResponseSchema,
  entryRegistrationStartSlotCandidatesSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { resolveVerifiedFixedStartSlotPlan } from "./verified-fixed-start-slot";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "REGISTER_ENTRY" as const;

export async function listEntryRegistrationClassesAsAdmin(db: Database, input: Authentication, now = new Date()) {
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [event] = await tx.select({ timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!event) throw new Error("Tävlingens tidszon saknas");
    const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule
    }).from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.classes.raceId, input.raceId), eq(schema.courses.raceId, input.raceId)))
      .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1_001);
    return { status: "ok" as const, response: entryRegistrationClassesResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId, snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, classes
    }) };
  });
}

type StartSlotAssignment = typeof schema.entryRegistrationStartSlotAssignments.$inferSelect;
function response(row: typeof schema.entryRegistrationRequests.$inferSelect, assignment: StartSlotAssignment | undefined, replayed: boolean) {
  const intent = entryRegistrationRequestSchema.parse(row.request);
  return entryRegistrationResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, entryVersion: 1, classId: intent.classId,
    givenName: intent.givenName, familyName: intent.familyName, organisationName: intent.organisationName,
    cardNumber: intent.cardNumber, assignmentId: row.assignmentId, fixedStartTime: intent.fixedStartTime,
    assignedStartSlot: assignment ? { assignmentId: assignment.id, drawRequestId: assignment.drawRequestId,
      sourceHash: assignment.sourceHash, fixedStartTime: assignment.fixedStartTime.toISOString() } : null,
    snapshotVersionBefore: intent.expectedSnapshotVersion, snapshotVersionAfter: row.snapshotVersionAfter,
    createdAt: row.createdAt.toISOString() });
}

export async function listEntryRegistrationStartSlotsAsAdmin(db: Database,
  input: Authentication & { targetClassId: string }, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [event] = await tx.select({ timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.raceId));
    if (!event) throw new Error("Tävlingens tidszon saknas");
    const [target] = await tx.select({ courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule,
      capacityVersion: schema.classes.capacityVersion }).from(schema.classes).where(and(
        eq(schema.classes.id, input.targetClassId), eq(schema.classes.raceId, input.raceId))).limit(1);
    if (!target) return { status: "not-found" as const };
    if (target.startRule !== "FIXED" || !await canAddClassEntry(tx, input.raceId, input.targetClassId)) return { status: "conflict" as const };
    const plan = await resolveVerifiedFixedStartSlotPlan(tx, input.raceId, input.targetClassId, now);
    return { status: "ok" as const, response: entryRegistrationStartSlotCandidatesSchema.parse({ formatVersion: 1,
      raceId: input.raceId, targetClassId: input.targetClassId, snapshotVersion: race.snapshotVersion,
      timeZone: event.timeZone,
      targetCourseVersionId: target.courseVersionId, targetCapacityVersion: target.capacityVersion, startRule: "FIXED",
      plan: plan.status === "AVAILABLE" ? { status: "AVAILABLE", drawRequestId: plan.drawRequestId,
        sourceHash: plan.sourceHash, slots: plan.slots.map(fixedStartTime => ({ fixedStartTime })) } : plan }) };
  }, { isolationLevel: "repeatable read" });
}

export async function registerEntryAsAdmin(db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryRegistrationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryRegistrationRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success) return { status: "invalid-request" as const };
  const intent = parsed.data;
  const requestId = key.data.slice("entry-registration:".length);
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(entryRegistrationRequestSchema.parse(existing.request)) !== JSON.stringify(intent)) return { status: "conflict" as const };
      const [assignment] = await tx.select().from(schema.entryRegistrationStartSlotAssignments)
        .where(eq(schema.entryRegistrationStartSlotAssignments.registrationRequestId, existing.id));
      return { status: "registered" as const, response: response(existing, assignment, true) };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const [raceClass] = await tx.select({ id: schema.classes.id, startRule: schema.classes.startRule,
      courseVersionId: schema.classes.courseVersionId, capacityVersion: schema.classes.capacityVersion }).from(schema.classes)
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, input.raceId), eq(schema.courses.raceId, input.raceId)));
    if (!raceClass || raceClass.startRule !== intent.expectedStartRule || raceClass.courseVersionId !== intent.expectedCourseVersionId) {
      return { status: "conflict" as const };
    }
    if (intent.assignedStartSlot !== undefined && intent.assignedStartSlot !== null &&
      (intent.expectedTargetCapacityVersion !== raceClass.capacityVersion || intent.fixedStartTime !== intent.assignedStartSlot.fixedStartTime)) {
      return { status: "conflict" as const };
    }
    const [total] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, input.raceId));
    if (!total || total.value >= 10_000) return { status: "conflict" as const };
    if (intent.cardNumber) {
      const [owner] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments).where(and(
        eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.cardNumber, intent.cardNumber)));
      if (owner) return { status: "conflict" as const };
    }
    if (!await canAddClassEntry(tx, input.raceId, intent.classId)) return { status: "conflict" as const };
    if (intent.assignedStartSlot !== undefined && intent.assignedStartSlot !== null) {
      const plan = await resolveVerifiedFixedStartSlotPlan(tx, input.raceId, intent.classId, now);
      if (plan.status !== "AVAILABLE" || plan.drawRequestId !== intent.assignedStartSlot.drawRequestId ||
        plan.sourceHash !== intent.assignedStartSlot.sourceHash || !plan.slots.includes(intent.assignedStartSlot.fixedStartTime)) {
        return { status: "conflict" as const };
      }
    }
    const [entry] = await tx.insert(schema.entries).values({ raceId: input.raceId, classId: intent.classId,
      givenName: intent.givenName, familyName: intent.familyName, organisationName: intent.organisationName,
      fixedStartTime: intent.fixedStartTime ? new Date(intent.fixedStartTime) : null, version: 1 }).returning({ id: schema.entries.id });
    if (!entry) throw new Error("Deltagaren kunde inte sparas");
    let assignmentId: string | null = null;
    if (intent.cardNumber) {
      const [assignment] = await tx.insert(schema.cardAssignments).values({ raceId: input.raceId,
        entryId: entry.id, cardNumber: intent.cardNumber }).returning({ id: schema.cardAssignments.id });
      if (!assignment) throw new Error("Brickkopplingen kunde inte sparas");
      assignmentId = assignment.id;
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    const [saved] = await tx.insert(schema.entryRegistrationRequests).values({ requestId, raceId: input.raceId,
      actorCredentialId: auth.principal.accessCredentialId, entryId: entry.id, assignmentId, request: intent,
      snapshotVersionAfter, createdAt: now }).returning();
    if (!saved) throw new Error("Registreringsjournalen kunde inte sparas");
    let startSlotAssignment: StartSlotAssignment | undefined;
    if (intent.assignedStartSlot !== undefined && intent.assignedStartSlot !== null) {
      const [assignment] = await tx.insert(schema.entryRegistrationStartSlotAssignments).values({
        registrationRequestId: saved.id, raceId: input.raceId, entryId: entry.id, targetClassId: intent.classId,
        drawRequestId: intent.assignedStartSlot.drawRequestId, sourceHash: intent.assignedStartSlot.sourceHash,
        fixedStartTime: new Date(intent.assignedStartSlot.fixedStartTime), actorCredentialId: auth.principal.accessCredentialId,
        capability: auth.principal.capability, assignedAt: now
      }).returning();
      if (!assignment) throw new Error("Startslotsjournalen kunde inte sparas");
      startSlotAssignment = assignment;
    }
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_REGISTERED_BY_ADMIN", actorKind: auth.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "ENTRY_REGISTRATION_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId, before: { snapshotVersion: race.snapshotVersion },
      after: { classId: intent.classId, assignmentId, entryVersion: 1, snapshotVersion: snapshotVersionAfter } });
    return { status: "registered" as const, response: response(saved, startSlotAssignment, false) };
  });
}
