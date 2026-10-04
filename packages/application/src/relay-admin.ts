import { and, asc, count, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import {
  relayClassCreateIdempotencyKeySchema, relayClassCreateRequestSchema, relayClassCreateResponseSchema,
  relayLegRunnerIdempotencyKeySchema, relayLegRunnerRequestSchema, relayLegRunnerResponseSchema,
  relayStartTimesIdempotencyKeySchema, relayStartTimesRequestSchema, relayStartTimesResponseSchema,
  relayTeamCreateIdempotencyKeySchema, relayTeamCreateRequestSchema, relayTeamCreateResponseSchema,
  type RelayClassCreateResponse, type RelayLegRunnerResponse, type RelayStartTimesResponse, type RelayTeamCreateResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { relayLegRuleProblem, relayTeamVariants } from "@o-tid/domain";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";
import { loadCourseVersionVariants } from "./course-variants";
import { loadRelayClassConfigs } from "./relay-model";
import { synchronizeRelayClass, synchronizeRelayTeams } from "./relay-sync";

/**
 * Stafettens administration (ADR-0169 beslut 3): ny stafettklass, nytt lag, byt sträcklöpare
 * och start-/omstartstider. Varje ändring sparas direkt (inget befintligt resultat byter status
 * utan att det syns i lagvyn), journalförs med request-id och ökar tävlingsversionen så att
 * avläsningspaketet hämtas på nytt.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type Kind = "CLASS" | "TEAM" | "LEG_RUNNER" | "START_TIMES";
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_VERSION = 2_147_483_647;

/**
 * Gemensam ram: autentisering, raslås, idempotens (samma request-id ger samma kvitto) och
 * kontroll av tävlingsversionen. `apply` gör ändringen och ger kvittot och journalens klass/lag.
 */
async function mutate<T extends { request: unknown }>(db: Database, input: Authentication, kind: Kind,
  intent: { requestId: string; expectedSnapshotVersion: number }, parse: (value: unknown) => T, now: Date,
  apply: (tx: Transaction, raceId: string, snapshotVersionAfter: number) => Promise<Failure | { response: T; classId: string; teamId: string | null }>)
  : Promise<Failure | { status: "saved"; response: T }> {
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"relay:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.relayRequests).where(eq(schema.relayRequests.requestId, intent.requestId));
    if (prior) {
      const response = parse(prior.response);
      if (prior.kind !== kind || prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "saved", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const snapshotVersionAfter = race.snapshotVersion + 1;
    const outcome = await apply(tx, raceId, snapshotVersionAfter);
    if ("status" in outcome) return outcome;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));
    await tx.insert(schema.relayRequests).values({ requestId: intent.requestId, raceId, kind, classId: outcome.classId,
      teamId: outcome.teamId, actorCredentialId: auth.principal.accessCredentialId, capability,
      request: intent as unknown as Record<string, unknown>, response: outcome.response as unknown as Record<string, unknown>, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: outcome.teamId ? "team" : "class",
      entityId: outcome.teamId ?? outcome.classId, requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, action: `RELAY_${kind}_SAVED_BY_ADMIN`,
      before: { snapshotVersion: race.snapshotVersion }, after: { snapshotVersion: snapshotVersionAfter }, createdAt: now });
    return { status: "saved", response: outcome.response };
  });
}

function parseIntent<T>(schemaLike: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown) {
  const parsed = schemaLike.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Brickor som redan används av en annan deltagare i loppet. */
async function cardsInUse(tx: Transaction, raceId: string, cards: readonly string[], exceptEntryId?: string): Promise<boolean> {
  if (cards.length === 0) return false;
  const [row] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments).where(and(
    eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true), inArray(schema.cardAssignments.cardNumber, [...cards]),
    ...(exceptEntryId ? [ne(schema.cardAssignments.entryId, exceptEntryId)] : []))).limit(1);
  return row !== undefined;
}

export type RelayClassCreateResult = Failure | { status: "saved"; response: RelayClassCreateResponse };

/** "Ny stafettklass": klass på en bana med sträckor och startsätt per sträcka. */
export async function createRelayClassAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayClassCreateResult> {
  const intent = parseIntent(relayClassCreateRequestSchema, input.request);
  const key = relayClassCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-class:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  if (relayLegRuleProblem(intent.legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod,
    ...(leg.startTime === null ? {} : { startTime: leg.startTime }) })))) return { status: "invalid-request" };
  return mutate(db, input, "CLASS", intent, value => relayClassCreateResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const [version] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.courses.id, intent.courseId), eq(schema.courses.raceId, raceId)))
      .orderBy(desc(schema.courseVersions.version)).limit(1);
    if (!version) return { status: "not-found" };
    const variants = (await loadCourseVersionVariants(tx, [version.id])).get(version.id) ?? [];
    if (intent.legs.some(leg => leg.variantCode !== null && !variants.some(variant => variant.code === leg.variantCode))) {
      return { status: "invalid-request" };
    }
    const [duplicate] = await tx.select({ id: schema.classes.id }).from(schema.classes)
      .where(and(eq(schema.classes.raceId, raceId), sql`lower(${schema.classes.name}) = lower(${intent.name})`)).limit(1);
    if (duplicate) return { status: "conflict" };
    const [raceClass] = await tx.insert(schema.classes).values({ raceId, name: intent.name, courseVersionId: version.id,
      startRule: "FIXED" }).returning({ id: schema.classes.id });
    if (!raceClass) throw new Error("Stafettklassen kunde inte skapas");
    await tx.insert(schema.relayLegs).values(intent.legs.map(leg => ({ classId: raceClass.id, raceId, leg: leg.leg,
      startMethod: leg.startMethod, startTime: leg.startTime === null ? null : new Date(leg.startTime), courseVariantCode: leg.variantCode })));
    const response = relayClassCreateResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      classId: raceClass.id, request: intent, snapshotVersionAfter, createdAt: now.toISOString() });
    return { response, classId: raceClass.id, teamId: null };
  });
}

export type RelayTeamCreateResult = Failure | { status: "saved"; response: RelayTeamCreateResponse };

/**
 * "Nytt lag": namn, klubb, nummer och en löpare (med bricka) per sträcka. En gafflad bana ger
 * varianter per sträcka (sträckans bestämda variant, annars roterade över lagen).
 */
export async function registerRelayTeamAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayTeamCreateResult> {
  const intent = parseIntent(relayTeamCreateRequestSchema, input.request);
  const key = relayTeamCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-team:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return mutate(db, input, "TEAM", intent, value => relayTeamCreateResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const config = (await loadRelayClassConfigs(tx, raceId)).get(intent.classId);
    const [raceClass] = await tx.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes)
      .where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, raceId)));
    if (!config || !raceClass) return { status: "not-found" };
    if (intent.runners.length !== config.legs.length) return { status: "invalid-request" };
    const cards = intent.runners.flatMap(runner => runner.cardNumber === null ? [] : [runner.cardNumber]);
    if (await cardsInUse(tx, raceId, cards)) return { status: "conflict" };
    const [highest] = await tx.select({ value: max(schema.teams.number) }).from(schema.teams).where(eq(schema.teams.raceId, raceId));
    const number = intent.number ?? (highest?.value ?? 0) + 1;
    const [taken] = await tx.select({ id: schema.teams.id }).from(schema.teams)
      .where(and(eq(schema.teams.raceId, raceId), eq(schema.teams.number, number)));
    const [entryTotal] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
    if (taken || number > 99_999 || (entryTotal?.value ?? 0) + config.legs.length > 10_000) return { status: "conflict" };
    const [teamCount] = await tx.select({ value: count() }).from(schema.teams).where(eq(schema.teams.classId, intent.classId));
    const variantCodes = ((await loadCourseVersionVariants(tx, [raceClass.courseVersionId])).get(raceClass.courseVersionId) ?? [])
      .map(variant => variant.code);
    const variants = relayTeamVariants({ variantCodes, legCount: config.legs.length, teamIndex: teamCount?.value ?? 0,
      fixedVariants: new Map(config.legs.flatMap(leg => leg.variantCode === null ? [] : [[leg.leg, leg.variantCode] as const])) });
    const [team] = await tx.insert(schema.teams).values({ raceId, classId: intent.classId, number, name: intent.name,
      organisationName: intent.organisationName }).returning({ id: schema.teams.id });
    if (!team) throw new Error("Laget kunde inte sparas");
    for (const [index, runner] of intent.runners.entries()) {
      const [entry] = await tx.insert(schema.entries).values({ raceId, classId: intent.classId, teamId: team.id, relayLeg: index + 1,
        givenName: runner.givenName, familyName: runner.familyName, organisationName: runner.organisationName ?? intent.organisationName,
        courseVariantCode: variants.get(index + 1) ?? null, version: 1 }).returning({ id: schema.entries.id });
      if (!entry) throw new Error("Sträcklöparen kunde inte sparas");
      if (runner.cardNumber !== null) await tx.insert(schema.cardAssignments).values({ raceId, entryId: entry.id, cardNumber: runner.cardNumber });
    }
    await synchronizeRelayTeams(tx, raceId, [team.id], snapshotVersionAfter);
    const response = relayTeamCreateResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      teamId: team.id, number, request: intent, snapshotVersionAfter, createdAt: now.toISOString() });
    return { response, classId: intent.classId, teamId: team.id };
  });
}

export type RelayLegRunnerResult = Failure | { status: "saved"; response: RelayLegRunnerResponse };

/**
 * "Byt löpare på sträcka N": ny löpare (namn, klubb, bricka) på sträckan. Sträckans resultat
 * och historik följer sträckan; en ny bricka kopplas och den gamla släpps.
 */
export async function changeRelayLegRunnerAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayLegRunnerResult> {
  const intent = parseIntent(relayLegRunnerRequestSchema, input.request);
  const key = relayLegRunnerIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-leg-runner:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return mutate(db, input, "LEG_RUNNER", intent, value => relayLegRunnerResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const [entry] = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, version: schema.entries.version })
      .from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.teamId, intent.teamId),
        eq(schema.entries.relayLeg, intent.leg))).for("update");
    if (!entry) return { status: "not-found" };
    if (entry.version !== intent.expectedEntryVersion || entry.version >= MAX_VERSION) return { status: "conflict" };
    const card = intent.runner.cardNumber;
    if (card !== null && await cardsInUse(tx, raceId, [card], entry.id)) return { status: "conflict" };
    const active = await tx.select({ id: schema.cardAssignments.id, cardNumber: schema.cardAssignments.cardNumber })
      .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.entryId, entry.id), eq(schema.cardAssignments.active, true)))
      .orderBy(asc(schema.cardAssignments.id));
    if (!(active.length === 1 && active[0]!.cardNumber === card)) {
      if (active.length > 0) await tx.update(schema.cardAssignments).set({ active: false })
        .where(inArray(schema.cardAssignments.id, active.map(row => row.id)));
      if (card !== null) await tx.insert(schema.cardAssignments).values({ raceId, entryId: entry.id, cardNumber: card });
    }
    await tx.update(schema.entries).set({ givenName: intent.runner.givenName, familyName: intent.runner.familyName,
      organisationName: intent.runner.organisationName, version: entry.version + 1 }).where(eq(schema.entries.id, entry.id));
    const { recalculated } = await synchronizeRelayTeams(tx, raceId, [intent.teamId], snapshotVersionAfter);
    const response = relayLegRunnerResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      teamId: intent.teamId, leg: intent.leg, entryId: entry.id, request: intent, recalculatedCount: recalculated, snapshotVersionAfter,
      changedAt: now.toISOString() });
    return { response, classId: entry.classId, teamId: intent.teamId };
  });
}

export type RelayStartTimesResult = Failure | { status: "saved"; response: RelayStartTimesResponse };

/** Masstart- och omstartstider för en stafettklass. Sträckor som får ny start räknas om. */
export async function setRelayStartTimesAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayStartTimesResult> {
  const intent = parseIntent(relayStartTimesRequestSchema, input.request);
  const key = relayStartTimesIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-start-times:${intent.requestId}` || !uuid.test(input.raceId) ||
      new Set(intent.legs.map(leg => leg.leg)).size !== intent.legs.length) return { status: "invalid-request" };
  return mutate(db, input, "START_TIMES", intent, value => relayStartTimesResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const config = (await loadRelayClassConfigs(tx, raceId)).get(intent.classId);
    if (!config) return { status: "not-found" };
    for (const change of intent.legs) {
      const leg = config.legs.find(candidate => candidate.leg === change.leg);
      if (!leg || leg.startMethod === "CHANGEOVER") return { status: "invalid-request" };
      await tx.update(schema.relayLegs).set({ startTime: new Date(change.startTime) })
        .where(and(eq(schema.relayLegs.classId, intent.classId), eq(schema.relayLegs.leg, change.leg)));
    }
    const { recalculated } = await synchronizeRelayClass(tx, raceId, intent.classId, snapshotVersionAfter);
    const response = relayStartTimesResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      classId: intent.classId, request: intent, recalculatedCount: recalculated, snapshotVersionAfter, changedAt: now.toISOString() });
    return { response, classId: intent.classId, teamId: null };
  });
}
