import { and, asc, count, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import {
  relayClassCreateIdempotencyKeySchema, relayClassCreateRequestSchema, relayClassCreateResponseSchema,
  relayLegRunnerIdempotencyKeySchema, relayLegRunnerRequestSchema, relayLegRunnerResponseSchema,
  relayStartTimesIdempotencyKeySchema, relayStartTimesRequestSchema, relayStartTimesResponseSchema,
  relayTeamCreateIdempotencyKeySchema, relayTeamCreateRequestSchema, relayTeamCreateResponseSchema,
  type RelayClassCreateResponse, type RelayLegRunnerResponse, type RelayLegSetting, type RelayStartTimesResponse, type RelayTeamCreateResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { relayLegRuleProblem, type RelayLegRule } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { loadCourseVersionVariants } from "./course-variants";
import { loadRelayClassConfigs } from "./relay-model";
import { synchronizeRelayClass, synchronizeRelayTeams } from "./relay-sync";
import { planNewRelayTeamVariants } from "./relay-variants";
import { classNameTaken } from "./duplicate-names";
import { bumpReadoutPackageVersion } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * Stafettens administration (ADR-0169 beslut 3): ny stafettklass, nytt lag, byt sträcklöpare
 * och start-/omstartstider. Varje ändring sparas direkt (inget befintligt resultat byter status
 * utan att det syns i lagvyn), journalförs med request-id och ökar tävlingsversionen så att
 * avläsningspaketet hämtas på nytt.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = RaceSessionProof;
type Kind = "CLASS" | "TEAM" | "LEG_RUNNER" | "START_TIMES" | "CLASS_EDIT" | "TEAM_EDIT" | "TEAM_STRIKE" | "TEAM_DID_NOT_START" | "LEG_VARIANT";
export type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "duplicate-name" };
export const MAX_VERSION = 2_147_483_647;

/**
 * Gemensam ram: autentisering, raslås, idempotens (samma request-id ger samma kvitto) och
 * kontroll av tävlingsversionen. `apply` gör ändringen och ger kvittot och journalens klass/lag.
 */
export async function mutate<T extends { request: unknown }, X = never>(db: Database, input: Authentication, kind: Kind,
  intent: { requestId: string }, parse: (value: unknown) => T, now: Date,
  apply: (tx: Transaction, raceId: string, snapshotVersionAfter: number, actorAccountId: string) =>
    Promise<Failure | X | { response: T; classId: string; teamId: string | null }>)
  : Promise<Failure | X | { status: "saved"; response: T }> {
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"relay:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.relayRequests).where(eq(schema.relayRequests.requestId, intent.requestId));
    if (prior) {
      const response = parse(prior.response);
      if (prior.kind !== kind || prior.raceId !== raceId || prior.actorAccountId !== auth.principal.accountId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "saved", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const snapshotVersionAfter = race.snapshotVersion + 1;
    const outcome = await apply(tx, raceId, snapshotVersionAfter, auth.principal.accountId);
    if (typeof outcome === "object" && outcome !== null && "status" in outcome) return outcome as Failure | X;
    const saved = outcome as { response: T; classId: string; teamId: string | null };
    await bumpReadoutPackageVersion(tx, raceId);
    await tx.insert(schema.relayRequests).values({ requestId: intent.requestId, raceId, kind, classId: saved.classId,
      teamId: saved.teamId, actorAccountId: auth.principal.accountId,
      request: intent as unknown as Record<string, unknown>, response: saved.response as unknown as Record<string, unknown>, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: saved.teamId ? "team" : "class",
      entityId: saved.teamId ?? saved.classId, requestId: intent.requestId, actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, action: `RELAY_${kind}_SAVED_BY_ADMIN`,
      before: { snapshotVersion: race.snapshotVersion }, after: { snapshotVersion: snapshotVersionAfter }, createdAt: now });
    return { status: "saved", response: saved.response };
  });
}

export function parseIntent<T>(schemaLike: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown) {
  const parsed = schemaLike.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Brickor som redan används av en annan deltagare i loppet. */
export async function cardsInUse(tx: Transaction, raceId: string, cards: readonly string[], exceptEntryId?: string): Promise<boolean> {
  if (cards.length === 0) return false;
  const [row] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments).where(and(
    eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true), inArray(schema.cardAssignments.cardNumber, [...cards]),
    ...(exceptEntryId ? [ne(schema.cardAssignments.entryId, exceptEntryId)] : []))).limit(1);
  return row !== undefined;
}

export type RelayClassCreateResult = Failure | { status: "saved"; response: RelayClassCreateResponse };

/** "Ny stafettklass": klass på en bana med sträckor och startsätt per sträcka. */
export async function createRelayClassAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayClassCreateResult> {
  const intent = parseIntent(relayClassCreateRequestSchema, input.request);
  const key = relayClassCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-class:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  if (relayLegRuleProblem(relayLegRules(intent.legs))) return { status: "invalid-request" };
  return mutate(db, input, "CLASS", intent, value => relayClassCreateResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const version = await latestCourseVersion(tx, raceId, intent.courseId);
    if (!version) return { status: "not-found" };
    const legCourses = await resolveLegCourses(tx, raceId, version, intent.legs);
    if (legCourses === "not-found") return { status: "not-found" };
    if (legCourses === "invalid") return { status: "invalid-request" };
    if (await classNameTaken(tx, raceId, intent.name)) return { status: "duplicate-name" };
    const [raceClass] = await tx.insert(schema.classes).values({ raceId, name: intent.name, courseVersionId: version,
      startRule: "FIXED", relayRestartRanking: intent.restartRanking, relayForking: intent.forking }).returning({ id: schema.classes.id });
    if (!raceClass) throw new Error("Stafettklassen kunde inte skapas");
    await tx.insert(schema.relayLegs).values(intent.legs.map(leg => relayLegRow(raceClass.id, raceId, leg, legCourses.get(leg.leg) ?? null)));
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
export async function registerRelayTeamAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RelayTeamCreateResult> {
  const intent = parseIntent(relayTeamCreateRequestSchema, input.request);
  const key = relayTeamCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-team:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return mutate(db, input, "TEAM", intent, value => relayTeamCreateResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const config = (await loadRelayClassConfigs(tx, raceId)).get(intent.classId);
    if (!config) return { status: "not-found" };
    if (intent.runners.length !== config.legs.length) return { status: "invalid-request" };
    const cards = intent.runners.flatMap(runner => runner.cardNumber === null ? [] : [runner.cardNumber]);
    if (await cardsInUse(tx, raceId, cards)) return { status: "conflict" };
    const [highest] = await tx.select({ value: max(schema.teams.number) }).from(schema.teams).where(eq(schema.teams.raceId, raceId));
    const number = intent.number ?? (highest?.value ?? 0) + 1;
    const [taken] = await tx.select({ id: schema.teams.id }).from(schema.teams)
      .where(and(eq(schema.teams.raceId, raceId), eq(schema.teams.number, number)));
    const [entryTotal] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
    if (taken || number > 99_999 || (entryTotal?.value ?? 0) + config.legs.length > 10_000) return { status: "conflict" };
    // Steg 47: rättvis fördelning utifrån klassens befintliga lag, med sträckornas egna banor.
    const variants = await planNewRelayTeamVariants(tx, config);
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
export async function changeRelayLegRunnerAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
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
export async function setRelayStartTimesAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
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
      if (!leg || leg.startMethod === "CHANGEOVER" || leg.startMethod === "FLYING_RESTART") return { status: "invalid-request" };
      await tx.update(schema.relayLegs).set({ startTime: new Date(change.startTime) })
        .where(and(eq(schema.relayLegs.classId, intent.classId), eq(schema.relayLegs.leg, change.leg)));
    }
    const { recalculated } = await synchronizeRelayClass(tx, raceId, intent.classId, snapshotVersionAfter);
    const response = relayStartTimesResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      classId: intent.classId, request: intent, recalculatedCount: recalculated, snapshotVersionAfter, changedAt: now.toISOString() });
    return { response, classId: intent.classId, teamId: null };
  });
}

/** Sträckornas regler i domänens form. */
export function relayLegRules(legs: readonly RelayLegSetting[]): RelayLegRule[] {
  return legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod, ...(leg.startTime === null ? {} : { startTime: leg.startTime }),
    ...(leg.restartAfterMinutes === null ? {} : { restartAfterMinutes: leg.restartAfterMinutes }) }));
}

/** Banans senaste version i loppet. */
export async function latestCourseVersion(tx: Transaction, raceId: string, courseId: string): Promise<string | undefined> {
  const [version] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)))
    .orderBy(desc(schema.courseVersions.version)).limit(1);
  return version?.id;
}

/**
 * Steg 47: sträckornas egna banor (senaste versionen) och kontroll av sträckans variant mot sträckans bana
 * (eller klassens). Ger banversion per sträcka med egen bana.
 */
export async function resolveLegCourses(tx: Transaction, raceId: string, classCourseVersionId: string, legs: readonly RelayLegSetting[])
  : Promise<Map<number, string> | "not-found" | "invalid"> {
  const result = new Map<number, string>();
  for (const leg of legs) {
    if (leg.courseId === null) continue;
    const version = await latestCourseVersion(tx, raceId, leg.courseId);
    if (!version) return "not-found";
    if (version !== classCourseVersionId) result.set(leg.leg, version);
  }
  const variants = await loadCourseVersionVariants(tx, [classCourseVersionId, ...result.values()]);
  for (const leg of legs) {
    if (leg.variantCode === null) continue;
    const version = result.get(leg.leg) ?? classCourseVersionId;
    if (!(variants.get(version) ?? []).some(variant => variant.code === leg.variantCode)) return "invalid";
  }
  return result;
}

export function relayLegRow(classId: string, raceId: string, leg: RelayLegSetting, courseVersionId: string | null) {
  return { classId, raceId, leg: leg.leg, startMethod: leg.startMethod, startTime: leg.startTime === null ? null : new Date(leg.startTime),
    courseVariantCode: leg.variantCode, courseVersionId, restartAfterMinutes: leg.restartAfterMinutes };
}
