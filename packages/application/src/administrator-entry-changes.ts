import { and, desc, eq, getTableColumns, lt, or, sql, type AnyColumn } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { administratorEntryChangesResponseSchema, type AdministratorEntryChangesResponse,
  entryTransferRequestSchema, entryRegistrationRequestSchema, entryIdentityValuesSchema,
  entryIdentityChangeResponseSchema, entryCardChangeResponseSchema, entryCardRentalChangeResponseSchema,
  entryCardRentalReturnChangeResponseSchema, entryCardRentalReuseResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

type Item = AdministratorEntryChangesResponse["items"][number];
type Change = Item["changes"][number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const exact = (column: AnyColumn) => sql<boolean>`${column} IS NULL OR date_trunc('milliseconds', ${column}) = ${column}`;
const timestamp = (column: AnyColumn) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function check(value: unknown): asserts value { if (!value) throw new Error("Deltagarhistorikens journal eller relation är ogiltig"); }
function instant(value: Date | null) { return value?.toISOString() ?? null; }

export async function listAdministratorEntryChanges(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { entryId: string; beforeVersion?: number },
  now = new Date()
) {
  if (!uuid.test(input.raceId) || !uuid.test(input.entryId) || (input.beforeVersion !== undefined &&
    (!Number.isInteger(input.beforeVersion) || input.beforeVersion < 1 || input.beforeVersion > 2_147_483_647))) return { status: "invalid-request" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const [race] = await tx.select().from(schema.races).where(eq(schema.races.id, auth.principal.raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.raceId, race.id), eq(schema.entries.id, input.entryId)));
    if (!entry) return { status: "not-found" as const };
    const [event] = await tx.select().from(schema.events).where(eq(schema.events.id, race.eventId)); check(event);
    const items: Item[] = [];
    const names = new Map<string, string>();
    const actors = new Map<string, string>();
    async function actor(id: string, capability?: string) {
      let actual = actors.get(id);
      if (!actual) {
        const [row] = await tx.select().from(schema.pairingAdminAccessCredentials).where(and(
          eq(schema.pairingAdminAccessCredentials.id, id), eq(schema.pairingAdminAccessCredentials.raceId, race!.id)));
        check(row); actual = row.capability; actors.set(id, actual);
      }
      check(capability === undefined || capability === actual);
    }
    async function className(id: string) {
      const known = names.get(id); if (known) return known;
      const [row] = await tx.select().from(schema.classes).where(and(eq(schema.classes.id, id), eq(schema.classes.raceId, race!.id)));
      check(row); names.set(id, row.name); return row.name;
    }
    async function course(id: string) {
      const [row] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
        .where(and(eq(schema.courseVersions.id, id), eq(schema.courses.raceId, race!.id))); check(row);
    }
    async function assignmentFor(entryId: string, id: string | null, number: string | null) {
      if (id === null) { check(number === null); return; }
      const [row] = await tx.select().from(schema.cardAssignments).where(and(eq(schema.cardAssignments.id, id),
        eq(schema.cardAssignments.raceId, race!.id), eq(schema.cardAssignments.entryId, entryId)));
      check(row && row.cardNumber === number);
    }
    async function assignment(id: string | null, number: string | null) { return assignmentFor(entry!.id, id, number); }
    function add(kind: Item["kind"], row: { requestId: string; changedAt: string; entryVersionBefore: number;
      entryVersionAfter: number; snapshotVersionBefore: number; snapshotVersionAfter: number }, changes: Change[]) {
      check(row.entryVersionBefore > 0 && row.entryVersionAfter === row.entryVersionBefore + 1 &&
        row.snapshotVersionBefore > 0 && row.snapshotVersionAfter === row.snapshotVersionBefore + 1);
      items.push({ kind, requestId: row.requestId, changedAt: row.changedAt,
        entryVersionAfter: row.entryVersionAfter, snapshotVersionAfter: row.snapshotVersionAfter, changes });
    }
    const boundary = (column: AnyColumn) => input.beforeVersion === undefined ? undefined : lt(column, input.beforeVersion);
    for (const table of [schema.entryClassChangeRequests, schema.entryTransferRequests, schema.entryCardChangeRequests,
      schema.entryStartTimeChangeRequests, schema.entryIdentityChangeRequests, schema.entryCardRentalChanges,
      schema.entryCardRentalReturnChanges] as const) {
      const rows = await tx.select({ ...getTableColumns(table), changedAt: timestamp(table.changedAt) }).from(table)
        .where(and(eq(table.raceId, race.id), eq(table.entryId, entry.id), boundary(table.entryVersionAfter)))
        .orderBy(desc(table.entryVersionAfter)).limit(21);
      for (const row of rows) {
        await actor(row.actorCredentialId, "capability" in row ? row.capability : undefined);
        if ("previousClassId" in row && "classId" in row) {
          check(row.expectedEntryVersion === row.entryVersionBefore && row.previousClassId !== row.classId);
          add("CLASS", row, [{ field: "CLASS", before: await className(row.previousClassId), after: await className(row.classId) }]);
        } else if ("targetClassId" in row) {
          const intent = entryTransferRequestSchema.parse(row.request);
          check(intent.expectedClassId === row.previousClassId && intent.targetClassId === row.targetClassId &&
            intent.expectedEntryVersion === row.entryVersionBefore && intent.expectedSnapshotVersion === row.snapshotVersionBefore);
          await course(intent.expectedTargetCourseVersionId);
          add("TRANSFER", row, [{ field: "CLASS", before: await className(row.previousClassId), after: await className(row.targetClassId) },
            { field: "START_TIME", before: intent.expectedFixedStartTime, after: intent.fixedStartTime }]);
        } else if ("activeAssignmentId" in row) {
          await className(row.classId); await assignment(row.previousAssignmentId, row.previousCardNumber);
          await assignment(row.activeAssignmentId, row.cardNumber);
          entryCardChangeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: row.requestId,
            raceId: race.id, entryId: entry.id, classId: row.classId,
            entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
            snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
            previousAssignment: row.previousAssignmentId === null ? null : { id: row.previousAssignmentId, cardNumber: row.previousCardNumber },
            activeAssignment: { id: row.activeAssignmentId, cardNumber: row.cardNumber }, changedAt: row.changedAt });
          add("CARD", row, [{ field: "CARD", before: row.previousCardNumber, after: row.cardNumber }]);
        } else if ("previousIsRental" in row) {
          await className(row.classId); await assignment(row.assignmentId, row.cardNumber);
          entryCardRentalChangeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: row.requestId,
            raceId: race.id, entryId: entry.id, classId: row.classId,
            assignment: { id: row.assignmentId, cardNumber: row.cardNumber },
            previousIsRental: row.previousIsRental, isRental: row.isRental,
            entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
            snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
            changedAt: row.changedAt });
          add("RENTAL", row, [{ field: "RENTAL", before: String(row.previousIsRental), after: String(row.isRental) }]);
        } else if ("previousRentalReturned" in row) {
          await className(row.classId); await assignment(row.assignmentId, row.cardNumber);
          entryCardRentalReturnChangeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: row.requestId,
            raceId: race.id, entryId: entry.id, classId: row.classId,
            assignment: { id: row.assignmentId, cardNumber: row.cardNumber },
            previousRentalReturned: row.previousRentalReturned, rentalReturned: row.rentalReturned,
            entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
            snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
            changedAt: row.changedAt });
          add("RENTAL_RETURN", row, [{ field: "RENTAL_RETURN", before: String(row.previousRentalReturned),
            after: String(row.rentalReturned) }]);
        } else if ("fixedStartTime" in row) {
          await className(row.classId);
          const [precision] = await tx.select({ previous: exact(schema.entryStartTimeChangeRequests.previousFixedStartTime),
            next: exact(schema.entryStartTimeChangeRequests.fixedStartTime) }).from(schema.entryStartTimeChangeRequests)
            .where(eq(schema.entryStartTimeChangeRequests.id, row.id));
          check(precision?.previous && precision.next && row.expectedEntryVersion === row.entryVersionBefore &&
            instant(row.previousFixedStartTime) !== instant(row.fixedStartTime));
          add("START_TIME", row, [{ field: "START_TIME", before: instant(row.previousFixedStartTime), after: instant(row.fixedStartTime) }]);
        } else if ("identity" in row) {
          await className(row.classId);
          const previous = entryIdentityValuesSchema.parse(row.previousIdentity), next = entryIdentityValuesSchema.parse(row.identity);
          entryIdentityChangeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: row.requestId,
            raceId: race.id, entryId: entry.id, classId: row.classId, previousIdentity: previous, identity: next,
            entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
            snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt });
          const fields = { givenName: "GIVEN_NAME", familyName: "FAMILY_NAME", organisationName: "ORGANISATION" } as const;
          add("IDENTITY", row, (Object.keys(fields) as (keyof typeof fields)[])
            .map(key => ({ field: fields[key], before: previous[key], after: next[key] })));
        }
      }
    }
    const reuseRows = await tx.select({ ...getTableColumns(schema.entryCardRentalReuseRequests),
      changedAt: timestamp(schema.entryCardRentalReuseRequests.changedAt) }).from(schema.entryCardRentalReuseRequests)
      .where(and(eq(schema.entryCardRentalReuseRequests.raceId, race.id), or(
        and(eq(schema.entryCardRentalReuseRequests.sourceEntryId, entry.id), input.beforeVersion === undefined ? undefined : lt(schema.entryCardRentalReuseRequests.sourceEntryVersionAfter, input.beforeVersion)),
        and(eq(schema.entryCardRentalReuseRequests.targetEntryId, entry.id), input.beforeVersion === undefined ? undefined : lt(schema.entryCardRentalReuseRequests.targetEntryVersionAfter, input.beforeVersion))
      ))).orderBy(desc(schema.entryCardRentalReuseRequests.changedAt)).limit(21);
    for (const row of reuseRows) {
      const isSource = row.sourceEntryId === entry.id, isTarget = row.targetEntryId === entry.id;
      check(isSource !== isTarget);
      await actor(row.actorCredentialId, row.capability);
      await className(row.sourceClassId); await className(row.targetClassId);
      await assignmentFor(row.sourceEntryId, row.sourceAssignmentId, row.cardNumber);
      await assignmentFor(row.targetEntryId, row.targetAssignmentId, row.cardNumber);
      entryCardRentalReuseResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: row.requestId, raceId: race.id,
        source: { entryId: row.sourceEntryId, classId: row.sourceClassId,
          assignment: { id: row.sourceAssignmentId, cardNumber: row.cardNumber } },
        target: { entryId: row.targetEntryId, classId: row.targetClassId,
          assignment: { id: row.targetAssignmentId, cardNumber: row.cardNumber, isRental: true, rentalReturned: false } },
        sourceEntryVersionBefore: row.sourceEntryVersionBefore, sourceEntryVersionAfter: row.sourceEntryVersionAfter,
        targetEntryVersionBefore: row.targetEntryVersionBefore, targetEntryVersionAfter: row.targetEntryVersionAfter,
        snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter, changedAt: row.changedAt });
      const history = isSource ? { entryVersionBefore: row.sourceEntryVersionBefore, entryVersionAfter: row.sourceEntryVersionAfter }
        : { entryVersionBefore: row.targetEntryVersionBefore, entryVersionAfter: row.targetEntryVersionAfter };
      const changes: Change[] = isSource
        ? [{ field: "RENTAL_REUSE", before: "RETURNED_RENTAL", after: "GIVEN_AWAY" }, { field: "CARD", before: row.cardNumber, after: null }]
        : [{ field: "RENTAL_REUSE", before: "NO_ACTIVE_CARD", after: "RECEIVED_NOT_RETURNED" }, { field: "CARD", before: null, after: row.cardNumber }];
      add("RENTAL_REUSE", { ...row, ...history }, changes);
    }
    const registrations = await tx.select({ ...getTableColumns(schema.entryRegistrationRequests), createdAt: timestamp(schema.entryRegistrationRequests.createdAt) })
      .from(schema.entryRegistrationRequests).where(and(eq(schema.entryRegistrationRequests.raceId, race.id),
        eq(schema.entryRegistrationRequests.entryId, entry.id), input.beforeVersion === undefined ? undefined : sql`1 < ${input.beforeVersion}`)).limit(21);
    for (const row of registrations) {
      await actor(row.actorCredentialId);
      const intent = entryRegistrationRequestSchema.parse(row.request);
      check(row.snapshotVersionAfter === intent.expectedSnapshotVersion + 1);
      await course(intent.expectedCourseVersionId); await assignment(row.assignmentId, intent.cardNumber);
      items.push({ kind: "REGISTRATION", requestId: row.requestId, changedAt: row.createdAt,
        entryVersionAfter: 1, snapshotVersionAfter: row.snapshotVersionAfter, changes: [
          { field: "CLASS", before: null, after: await className(intent.classId) },
          { field: "GIVEN_NAME", before: null, after: intent.givenName },
          { field: "FAMILY_NAME", before: null, after: intent.familyName },
          { field: "ORGANISATION", before: null, after: intent.organisationName },
          { field: "CARD", before: null, after: intent.cardNumber },
          { field: "START_TIME", before: null, after: intent.fixedStartTime }
        ] });
    }
    items.sort((a, b) => b.entryVersionAfter - a.entryVersionAfter);
    check(new Set(items.map(row => row.entryVersionAfter)).size === items.length &&
      items.every(row => row.entryVersionAfter <= entry.version && row.snapshotVersionAfter <= race.snapshotVersion));
    const page = items.slice(0, 20);
    return { status: "ok" as const, response: administratorEntryChangesResponseSchema.parse({ formatVersion: 1,
      raceId: race.id, entryId: entry.id, entryVersion: entry.version, snapshotVersion: race.snapshotVersion,
      generatedAt: now.toISOString(), timeZone: event.timeZone, items: page,
      nextBeforeVersion: items.length > 20 ? page.at(-1)!.entryVersionAfter : null }) };
  }, { isolationLevel: "repeatable read" });
}
