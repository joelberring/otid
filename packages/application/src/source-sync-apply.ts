import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import { syncConsequenceSchema, type SyncConsequence } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  DID_NOT_START_POLICY_VERSION, parseRaceClock, relayTeamVariants, withProposedClass, withProposedClassSetup, withProposedCourse,
  withProposedCourseVersion, withProposedEntryClasses, type RaceSnapshot
} from "@o-tid/domain";
import { insertCourseVersionControls, leastUsedVariantForClass, loadCourseVersionVariants, variantAfterClassChange } from "./course-variants";
import { insertDidNotStartDecision } from "./did-not-start";
import { importPersonCourseAssignments, importTeamCourseAssignments } from "./import-iof";
import { loadRelayClassConfigs } from "./relay-model";
import { synchronizeRelayTeams } from "./relay-sync";
import { assessReadOutEntries, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry } from "./result-reassessment";
import { loadRaceSnapshot } from "./snapshot";
import {
  fullName, PLACEHOLDER_COURSE, type ClassRef, type CourseFileAction, type CourseFileProjection, type CourseRef, type CurrentState,
  type EventorAction, type EventorProjection, type PlannedRow
} from "./source-sync-model";

/**
 * Besked och sparande för en godkänd uppdatering (ADR-0170 beslut 4). Ändringar som påverkar
 * resultat (klassbyte, ny bana, ny banversion) prövas mot resultatmotorn med samma
 * omprövning som "Redigera bana"; vid sparande räknas berörda resultat om i samma
 * transaktion med nya revisioner. Råa avläsningar och äldre revisioner ändras aldrig.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const EPOCH = new Date(0).toISOString();

export class SourceSyncConflictError extends Error {}

/** Nya id:n bestäms i förväg så att beskedets ögonblicksbild och det sparade har samma id:n. */
interface Ids { readonly classes: Map<string, string>; readonly courses: Map<string, { courseId: string; versionId: string }>;
  readonly versions: Map<string, string>; placeholder?: { courseId: string; versionId: string; exists: boolean } }

function newIds(): Ids { return { classes: new Map(), courses: new Map(), versions: new Map() }; }

function classIdOf(ref: ClassRef, ids: Ids): string {
  return "existing" in ref ? ref.existing : ids.classes.get(ref.newEventorClass)!;
}

/** Resultatet av prövningen: beskedet och vad som ska räknas om efter sparandet. */
export interface Assessment {
  readonly consequence: SyncConsequence;
  readonly assessed: readonly AssessedEntry[];
  /** Klassen som varje omprövad löpare har efter sparandet. */
  readonly finalClass: ReadonlyMap<string, string>;
}

function consequence(assessed: readonly AssessedEntry[], cardsAfterReadout: SyncConsequence["cardsAfterReadout"]): SyncConsequence {
  const summary = summarizeAssessment(assessed);
  return syncConsequenceSchema.parse({ ...summary, cardsAfterReadout,
    requiresConfirmation: summary.requiresConfirmation || cardsAfterReadout.length > 0 });
}

// ---------------------------------------------------------------- Eventor

function placeholderFor(state: CurrentState, ids: Ids) {
  if (!ids.placeholder) {
    const existing = state.courses.find(course => course.externalSource === PLACEHOLDER_COURSE.externalSource &&
      course.externalId === PLACEHOLDER_COURSE.externalId);
    ids.placeholder = existing ? { courseId: existing.id, versionId: existing.versionId, exists: true }
      : { courseId: randomUUID(), versionId: randomUUID(), exists: false };
  }
  return ids.placeholder;
}

function prepareEventor(rows: readonly PlannedRow<EventorAction>[], state: CurrentState): Ids {
  const ids = newIds();
  for (const { action } of rows) if (action.type === "CREATE_CLASS") { ids.classes.set(action.eventorId, randomUUID()); placeholderFor(state, ids); }
  return ids;
}

export async function assessEventor(tx: Transaction, raceId: string, rows: readonly PlannedRow<EventorAction>[], state: CurrentState,
  ids: Ids = prepareEventor(rows, state)): Promise<Assessment & { ids: Ids }> {
  const moves = new Map<string, string>();
  const cardsAfterReadout: SyncConsequence["cardsAfterReadout"] = [];
  const entryById = new Map(state.entries.map(entry => [entry.id, entry]));
  for (const { action } of rows) {
    if (action.type !== "UPDATE_ENTRY") continue;
    const entry = entryById.get(action.entryId)!;
    if (action.classRef && entry.readOut) moves.set(entry.id, classIdOf(action.classRef, ids));
    if (action.cardNumber && entry.readOut) cardsAfterReadout.push({ displayName: fullName(entry.givenName, entry.familyName),
      cardNumber: action.cardNumber });
  }
  if (moves.size === 0) return { consequence: consequence([], cardsAfterReadout), assessed: [], finalClass: moves, ids };
  const snapshot = await loadRaceSnapshot(tx, raceId);
  let proposed: RaceSnapshot = snapshot;
  const placeholder = ids.placeholder;
  if (placeholder && !placeholder.exists) {
    proposed = withProposedCourse(proposed, { id: placeholder.courseId, raceId, name: PLACEHOLDER_COURSE.name });
    proposed = withProposedCourseVersion(proposed, placeholder.courseId, "", { id: placeholder.versionId, version: 1, createdAt: EPOCH, controlCodes: [] });
  }
  for (const { action } of rows) {
    if (action.type === "CREATE_CLASS") proposed = withProposedClass(proposed, { id: ids.classes.get(action.eventorId)!, raceId,
      name: action.name, courseVersionId: placeholder!.versionId, startRule: "PUNCH" });
  }
  proposed = withProposedEntryClasses(proposed, moves);
  const fromClasses = state.classes.filter(raceClass => [...moves.keys()].some(id => entryById.get(id)!.classId === raceClass.id));
  const assessed = await assessReadOutEntries(tx, raceId, fromClasses, snapshot, proposed);
  if (assessed === "too-large") throw new SourceSyncConflictError("too-large");
  const moved = assessed.filter(row => moves.has(row.entryId));
  return { consequence: consequence(moved, cardsAfterReadout), assessed: moved, finalClass: moves, ids };
}

/** Brickorna efter uppdateringen får inte krocka: varje bricka högst en aktiv deltagare. */
function assertCards(rows: readonly PlannedRow<EventorAction>[], state: CurrentState): void {
  const owner = new Map(state.entries.filter(entry => entry.cardNumber).map(entry => [entry.cardNumber!, entry.id]));
  const claims: [string, string][] = [];
  for (const { action } of rows) {
    if (action.type === "UPDATE_ENTRY" && action.cardNumber) {
      const current = state.entries.find(entry => entry.id === action.entryId)!.cardNumber;
      if (current) owner.delete(current);
      claims.push([action.cardNumber, action.entryId]);
    }
    if (action.type === "CREATE_ENTRY" && action.cardNumber) claims.push([action.cardNumber, `new:${action.eventorId}`]);
    if (action.type === "CREATE_TEAM") for (const runner of action.runners) if (runner.cardNumber) claims.push([runner.cardNumber, `new:${action.eventorId}:${runner.leg}`]);
  }
  for (const [card, claimer] of claims) {
    if (owner.has(card) && owner.get(card) !== claimer) throw new SourceSyncConflictError("card");
    owner.set(card, claimer);
  }
}

async function activateCard(tx: Transaction, raceId: string, entryId: string, cardNumber: string): Promise<void> {
  const [previous] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments).where(and(
    eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.entryId, entryId), eq(schema.cardAssignments.cardNumber, cardNumber)));
  if (previous) await tx.update(schema.cardAssignments).set({ active: true }).where(eq(schema.cardAssignments.id, previous.id));
  else await tx.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });
}

async function withdraw(tx: Transaction, raceId: string, entryIds: readonly string[], actorCredentialId: string, snapshotVersion: number, now: Date) {
  for (const entryId of entryIds) {
    const [entry] = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, version: schema.entries.version,
      courseVersionId: schema.classes.courseVersionId }).from(schema.entries)
      .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId)).where(eq(schema.entries.id, entryId));
    const [revision] = await tx.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, entryId));
    if (!entry || (revision?.value ?? 0) > 0) throw new SourceSyncConflictError("withdraw");
    await insertDidNotStartDecision(tx, { requestId: randomUUID(), raceId, actorCredentialId, entryId, entryVersion: entry.version,
      classId: entry.classId, courseVersionId: entry.courseVersionId, snapshotVersion, policyVersion: DID_NOT_START_POLICY_VERSION, decidedAt: now });
  }
}

export interface ApplyInput {
  readonly raceId: string; readonly actorCredentialId: string; readonly snapshotVersionAfter: number; readonly now: Date;
  readonly state: CurrentState;
}

/** Sparar de godkända raderna från Eventor och räknar om berörda resultat. Ger antal omräknade. */
export async function applyEventor(tx: Transaction, input: ApplyInput, projection: EventorProjection, rows: readonly PlannedRow<EventorAction>[],
  links: readonly { id: string; externalId: string }[], assessment: Assessment & { ids: Ids }): Promise<number> {
  const { raceId, state, now } = input;
  const { ids } = assessment;
  assertCards(rows, state);
  for (const link of links) await tx.update(schema.classes).set({ externalSource: "eventor", externalId: link.externalId })
    .where(and(eq(schema.classes.id, link.id), eq(schema.classes.raceId, raceId)));
  const placeholder = ids.placeholder;
  if (placeholder && !placeholder.exists) {
    await tx.insert(schema.courses).values({ id: placeholder.courseId, raceId, name: PLACEHOLDER_COURSE.name,
      externalSource: PLACEHOLDER_COURSE.externalSource, externalId: PLACEHOLDER_COURSE.externalId });
    await tx.insert(schema.courseVersions).values({ id: placeholder.versionId, courseId: placeholder.courseId, version: 1 });
  }
  const legCount = new Map(state.classes.map(raceClass => [raceClass.id, raceClass.legCount]));
  const massStart = parseRaceClock(state.raceDate, projection.event.clock ?? "10:00", state.timeZone);
  for (const { action } of rows) {
    if (action.type === "CREATE_CLASS") {
      const id = ids.classes.get(action.eventorId)!;
      await tx.insert(schema.classes).values({ id, raceId, name: action.name, courseVersionId: placeholder!.versionId,
        startRule: action.legCount > 0 ? "FIXED" : "PUNCH", externalSource: "eventor", externalId: action.eventorId });
      legCount.set(id, action.legCount);
      if (action.legCount > 0) {
        if (!massStart) throw new SourceSyncConflictError("mass-start");
        await tx.insert(schema.relayLegs).values(Array.from({ length: action.legCount }, (_, index) => ({ classId: id, raceId, leg: index + 1,
          startMethod: index === 0 ? "MASS_START" as const : "CHANGEOVER" as const, startTime: index === 0 ? new Date(massStart) : null })));
      }
    }
    if (action.type === "RENAME_CLASS") await tx.update(schema.classes).set({ name: action.name }).where(eq(schema.classes.id, action.classId));
  }
  // Brickor som byts släpps först, så att två löpare kan byta brickor med varandra.
  const changingCards = rows.flatMap(({ action }) => action.type === "UPDATE_ENTRY" && action.cardNumber ? [action.entryId] : []);
  if (changingCards.length > 0) await tx.update(schema.cardAssignments).set({ active: false }).where(and(
    eq(schema.cardAssignments.raceId, raceId), inArray(schema.cardAssignments.entryId, changingCards), eq(schema.cardAssignments.active, true)));
  const relayTeams = new Set<string>();
  for (const { action } of rows) {
    if (action.type === "CREATE_ENTRY") {
      const classId = classIdOf(action.classRef, ids);
      const [entry] = await tx.insert(schema.entries).values({ raceId, classId, givenName: action.givenName, familyName: action.familyName,
        organisationName: action.club, externalSource: "eventor", externalId: action.eventorId,
        courseVariantCode: await leastUsedVariantForClass(tx, raceId, classId) }).returning({ id: schema.entries.id });
      if (action.cardNumber) await activateCard(tx, raceId, entry!.id, action.cardNumber);
    }
    if (action.type === "UPDATE_ENTRY") {
      const local = state.entries.find(entry => entry.id === action.entryId)!;
      const classId = action.classRef ? classIdOf(action.classRef, ids) : undefined;
      const [current] = await tx.select({ code: schema.entries.courseVariantCode }).from(schema.entries).where(eq(schema.entries.id, local.id));
      await tx.update(schema.entries).set({ ...(action.name ?? {}), ...(action.club !== undefined ? { organisationName: action.club } : {}),
        ...(classId ? { classId, courseVariantCode: await variantAfterClassChange(tx, raceId, local.id, classId, current?.code ?? null) } : {}),
        ...(action.eventorId ? { externalSource: "eventor", externalId: action.eventorId } : {}),
        version: sql`${schema.entries.version} + 1` }).where(eq(schema.entries.id, local.id));
      if (action.cardNumber) await activateCard(tx, raceId, local.id, action.cardNumber);
      if (local.teamId) relayTeams.add(local.teamId);
    }
    if (action.type === "WITHDRAW") await withdraw(tx, raceId, action.entryIds, input.actorCredentialId, input.snapshotVersionAfter, now);
    if (action.type === "UPDATE_TEAM") {
      await tx.update(schema.teams).set({ ...(action.name ? { name: action.name } : {}),
        ...(action.club !== undefined ? { organisationName: action.club } : {}) }).where(eq(schema.teams.id, action.teamId));
    }
    if (action.type === "CREATE_TEAM") relayTeams.add(await createTeam(tx, raceId, action, classIdOf(action.classRef, ids), legCount));
  }
  await tx.update(schema.races).set({ snapshotVersion: input.snapshotVersionAfter }).where(eq(schema.races.id, raceId));
  if (relayTeams.size > 0) await synchronizeRelayTeams(tx, raceId, [...relayTeams], input.snapshotVersionAfter);
  return recalculate(tx, raceId, assessment, input.snapshotVersionAfter);
}

async function createTeam(tx: Transaction, raceId: string, action: Extract<EventorAction, { type: "CREATE_TEAM" }>, classId: string,
  legCount: ReadonlyMap<string, number>): Promise<string> {
  const legs = legCount.get(classId) ?? 0;
  const [highest] = await tx.select({ value: max(schema.teams.number) }).from(schema.teams).where(eq(schema.teams.raceId, raceId));
  const [teamCount] = await tx.select({ value: count() }).from(schema.teams).where(eq(schema.teams.classId, classId));
  const [raceClass] = await tx.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes).where(eq(schema.classes.id, classId));
  const config = (await loadRelayClassConfigs(tx, raceId)).get(classId);
  const codes = ((await loadCourseVersionVariants(tx, [raceClass!.courseVersionId])).get(raceClass!.courseVersionId) ?? []).map(variant => variant.code);
  const variants = relayTeamVariants({ variantCodes: codes, legCount: legs, teamIndex: teamCount?.value ?? 0,
    fixedVariants: new Map((config?.legs ?? []).flatMap(leg => leg.variantCode === null ? [] : [[leg.leg, leg.variantCode] as const])) });
  const [team] = await tx.insert(schema.teams).values({ raceId, classId, number: (highest?.value ?? 0) + 1, name: action.name,
    organisationName: action.club, externalSource: "eventor", externalId: action.eventorId }).returning({ id: schema.teams.id });
  for (let leg = 1; leg <= legs; leg += 1) {
    const runner = action.runners.find(row => row.leg === leg);
    // Sträcka utan löpare i Eventor: platsen finns och fylls i när laget anmält löparen.
    const named = runner?.familyName ? runner : undefined;
    const [entry] = await tx.insert(schema.entries).values({ raceId, classId, teamId: team!.id, relayLeg: leg,
      givenName: named?.givenName ?? "Vakant", familyName: named?.familyName ?? `sträcka ${leg}`, organisationName: runner?.club ?? action.club,
      courseVariantCode: variants.get(leg) ?? null, externalSource: "eventor", externalId: `${action.eventorId}:${leg}` })
      .returning({ id: schema.entries.id });
    if (runner?.cardNumber) await activateCard(tx, raceId, entry!.id, runner.cardNumber);
  }
  return team!.id;
}

async function recalculate(tx: Transaction, raceId: string, assessment: Assessment, snapshotVersion: number): Promise<number> {
  if (assessment.assessed.length === 0) return 0;
  const classes = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId }).from(schema.classes)
    .where(eq(schema.classes.raceId, raceId));
  const versions = new Map(classes.map(row => [row.id, row.courseVersionId]));
  const assessed = assessment.assessed.map(row => ({ ...row, classId: assessment.finalClass.get(row.entryId) ?? row.classId }));
  const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot: await loadRaceSnapshot(tx, raceId),
    snapshotVersion, courseVersionId: versions });
  return recalculated.length;
}

// ---------------------------------------------------------------- Banfil

function prepareCourseFile(rows: readonly PlannedRow<CourseFileAction>[]): Ids {
  const ids = newIds();
  for (const { action } of rows) {
    if (action.type === "CREATE_COURSE") ids.courses.set(action.externalId, { courseId: randomUUID(), versionId: randomUUID() });
    if (action.type === "CHANGE_COURSE") ids.versions.set(action.courseId, randomUUID());
  }
  return ids;
}

function versionOf(ref: CourseRef, ids: Ids, state: CurrentState): string {
  if ("newCourse" in ref) return ids.courses.get(ref.newCourse)!.versionId;
  return ids.versions.get(ref.existing) ?? state.courses.find(course => course.id === ref.existing)!.versionId;
}

export async function assessCourseFile(tx: Transaction, raceId: string, rows: readonly PlannedRow<CourseFileAction>[], state: CurrentState,
  ids: Ids = prepareCourseFile(rows)): Promise<Assessment & { ids: Ids }> {
  const affected = new Set<string>();
  for (const { action } of rows) {
    if (action.type === "CHANGE_COURSE") for (const raceClass of state.classes) if (raceClass.courseId === action.courseId) affected.add(raceClass.id);
    if (action.type === "CHANGE_CLASS_COURSE") affected.add(action.classId);
  }
  const readOut = state.entries.some(entry => entry.readOut && affected.has(entry.classId));
  if (!readOut) return { consequence: consequence([], []), assessed: [], finalClass: new Map(), ids };
  const snapshot = await loadRaceSnapshot(tx, raceId);
  let proposed = snapshot;
  for (const { action } of rows) {
    if (action.type === "CREATE_COURSE") {
      const created = ids.courses.get(action.externalId)!;
      proposed = withProposedCourse(proposed, { id: created.courseId, raceId, name: action.name });
      proposed = withProposedCourseVersion(proposed, created.courseId, "", { id: created.versionId, version: 1, createdAt: EPOCH,
        controlCodes: action.controlCodes, ...(action.variants.length > 0 ? { variants: action.variants } : {}) });
    }
    if (action.type === "CHANGE_COURSE") {
      const current = state.courses.find(course => course.id === action.courseId)!;
      proposed = withProposedCourseVersion(proposed, current.id, current.versionId, { id: ids.versions.get(current.id)!,
        version: current.version + 1, createdAt: EPOCH, controlCodes: action.controlCodes, ...(action.variants.length > 0 ? { variants: action.variants } : {}) });
    }
  }
  for (const { action } of rows) {
    if (action.type !== "CHANGE_CLASS_COURSE") continue;
    const raceClass = state.classes.find(row => row.id === action.classId)!;
    proposed = withProposedClassSetup(proposed, { classId: raceClass.id, courseVersionId: versionOf(action.courseRef, ids, state),
      startRule: raceClass.startRule });
  }
  const assessed = await assessReadOutEntries(tx, raceId, state.classes.filter(raceClass => affected.has(raceClass.id)), snapshot, proposed);
  if (assessed === "too-large") throw new SourceSyncConflictError("too-large");
  return { consequence: consequence(assessed, []), assessed, finalClass: new Map(), ids };
}

/** Sparar de godkända raderna ur banfilen och räknar om berörda resultat. Ger antal omräknade. */
export async function applyCourseFile(tx: Transaction, input: ApplyInput, projection: CourseFileProjection,
  rows: readonly PlannedRow<CourseFileAction>[], links: readonly { id: string; externalId: string }[],
  assessment: Assessment & { ids: Ids }): Promise<number> {
  const { raceId, state } = input;
  const { ids } = assessment;
  for (const link of links) await tx.update(schema.courses).set({ externalSource: "iof", externalId: link.externalId })
    .where(and(eq(schema.courses.id, link.id), eq(schema.courses.raceId, raceId)));
  for (const { action } of rows) {
    if (action.type === "CREATE_COURSE") {
      const created = ids.courses.get(action.externalId)!;
      await tx.insert(schema.courses).values({ id: created.courseId, raceId, name: action.name, externalSource: "iof", externalId: action.externalId });
      await tx.insert(schema.courseVersions).values({ id: created.versionId, courseId: created.courseId, version: 1 });
      await insertCourseVersionControls(tx, raceId, created.versionId, action.controlCodes, action.variants);
    }
    if (action.type === "CHANGE_COURSE") {
      const current = state.courses.find(course => course.id === action.courseId)!;
      const versionId = ids.versions.get(current.id)!;
      await tx.insert(schema.courseVersions).values({ id: versionId, courseId: current.id, version: current.version + 1 });
      await insertCourseVersionControls(tx, raceId, versionId, action.controlCodes, action.variants);
      await tx.update(schema.classes).set({ courseVersionId: versionId })
        .where(and(eq(schema.classes.raceId, raceId), eq(schema.classes.courseVersionId, current.versionId)));
    }
  }
  for (const { action } of rows) {
    if (action.type === "CREATE_CLASS") await tx.insert(schema.classes).values({ raceId, name: action.name,
      courseVersionId: versionOf(action.courseRef, ids, state), startRule: "PUNCH", externalSource: "iof", externalId: action.externalId });
    if (action.type === "CHANGE_CLASS_COURSE") await tx.update(schema.classes).set({ courseVersionId: versionOf(action.courseRef, ids, state) })
      .where(and(eq(schema.classes.id, action.classId), eq(schema.classes.raceId, raceId)));
  }
  // Varianter per löpare och lag ur filen; den som läst ut behåller sin variant.
  const keep = new Set(state.entries.filter(entry => entry.readOut || entry.hasResult).map(entry => entry.id));
  await importPersonCourseAssignments(tx, raceId, projection.data, keep);
  await importTeamCourseAssignments(tx, raceId, projection.data, keep);
  await tx.update(schema.races).set({ snapshotVersion: input.snapshotVersionAfter }).where(eq(schema.races.id, raceId));
  return recalculate(tx, raceId, assessment, input.snapshotVersionAfter);
}
