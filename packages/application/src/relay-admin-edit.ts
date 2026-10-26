import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  relayClassEditIdempotencyKeySchema, relayClassEditPreviewSchema, relayClassEditRequestSchema, relayClassEditResponseSchema,
  relayLegVariantIdempotencyKeySchema, relayLegVariantRequestSchema, relayLegVariantResponseSchema,
  relayTeamDidNotStartIdempotencyKeySchema, relayTeamDidNotStartRequestSchema, relayTeamDidNotStartResponseSchema,
  relayTeamEditIdempotencyKeySchema, relayTeamEditRequestSchema, relayTeamEditResponseSchema,
  relayTeamRemovalIdempotencyKeySchema, relayTeamRemovalRequestSchema, relayTeamRemovalResponseSchema, type RelayTeamRemovalResponse,
  type RelayClassEditPreview, type RelayClassEditResponse, type RelayLegVariantResponse, type RelayTeamDidNotStartResponse,
  type RelayTeamEditResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { planRelayTeamVariants, relayLegRuleProblem, relaySeedOf, type RaceSnapshot } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { bumpReadoutPackageVersion } from "./snapshot";
import { classNameTaken } from "./duplicate-names";
import { applyEntryDecision } from "./entry-status";
import { PurgeProtectedError, purgeRows } from "./purge";
import {
  MAX_VERSION, latestCourseVersion, mutate, parseIntent, relayLegRow, relayLegRules, resolveLegCourses, type Failure, type Transaction
} from "./relay-admin";
import { loadRelayClassConfigs, type RelayClassConfig } from "./relay-model";
import { recomputeRelayStarts, synchronizeRelayClass } from "./relay-sync";
import { loadRelayLegCourses, loadRelayTeamVariantPlans } from "./relay-variants";
import { loadResultBasisHashes } from "./result-basis";
import { assessReadOutEntries, recalculateAssessedEntries, type AssessedEntry } from "./result-reassessment";
import { loadRaceSnapshot } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * Steg 47 (ADR-0174): ändra stafettklassen efter att den skapats, ändra och ta bort lag, hela laget ej start och
 * byt variant på en sträcka. Som "Redigera bana": ändringen görs, sträckornas starter räknas om och varje avläst
 * sträcka vars underlag ändrats räknas om i samma transaktion. Byter någon status visas först ett besked i klartext
 * (förhandsvisning, inget sparas) och arrangören bekräftar. Allt journalförs med request-id och en auditpost.
 */
type Authentication = RaceSessionProof;
type Input = Authentication & { idempotencyKey: string | null; request: unknown };
type Confirmation = { status: "confirmation-required"; preview: RelayClassEditPreview };
type LegHasResult = { status: "leg-has-result" };

/** Förhandsbeskedet rullar tillbaka transaktionen utan att något sparas. */
class PreviewOnly extends Error {
  constructor(readonly preview: RelayClassEditPreview) { super("Förhandsvisning"); }
}

async function teamNumbers(tx: Transaction, classId: string): Promise<Map<string, number>> {
  return new Map((await tx.select({ id: schema.teams.id, number: schema.teams.number }).from(schema.teams)
    .where(eq(schema.teams.classId, classId))).map(row => [row.id, row.number]));
}

/**
 * Efter ändringen: avlästa sträckor i klassen vars underlag ändrats räknas om; beskedet jämför statusen före
 * (ögonblicksbilden `before`) med efter. Utan bekräftelse och med statusbyten rullas allt tillbaka.
 */
async function recalculateChanged(tx: Transaction, input: { raceId: string; classId: string; className: string; before: RaceSnapshot;
  snapshotVersion: number; confirm: boolean; addedLegs: number[]; removedLegs: number[]; removedRunners: number; entryIds?: string[] })
  : Promise<{ preview: RelayClassEditPreview; recalculated: number }> {
  const after = await loadRaceSnapshot(tx, input.raceId);
  const assessed = await assessReadOutEntries(tx, input.raceId, [{ id: input.classId, name: input.className }], input.before, after,
    input.entryIds);
  if (assessed === "too-large") throw new Error("Stafettklassen är för stor");
  const hashes = await loadResultBasisHashes(tx, input.raceId);
  const stale = (row: AssessedEntry) => row.recalculate && (row.changed || row.latest?.basisHash !== hashes.get(row.entryId));
  const toRecalculate = assessed.filter(stale);
  const entries = new Map(after.entries.map(entry => [entry.id, entry]));
  const legOf = new Map((await tx.select({ id: schema.entries.id, leg: schema.entries.relayLeg, teamId: schema.entries.teamId })
    .from(schema.entries).where(eq(schema.entries.classId, input.classId))).map(row => [row.id, row]));
  const numbers = await teamNumbers(tx, input.classId);
  const changes = toRecalculate.filter(row => row.outcome === "BECOMES_OK" || row.outcome === "BECOMES_MISPUNCHED").map(row => {
    const place = legOf.get(row.entryId);
    const entry = entries.get(row.entryId);
    return { displayName: entry ? `${entry.givenName} ${entry.familyName}` : row.displayName, leg: place?.leg ?? 1,
      teamNumber: numbers.get(place?.teamId ?? "") ?? 1, before: row.before, after: row.after };
  });
  const preview = relayClassEditPreviewSchema.parse({ formatVersion: 1, raceId: input.raceId, classId: input.classId,
    readOutCount: assessed.length, recalculatedCount: toRecalculate.length, changes, addedLegs: input.addedLegs,
    removedLegs: input.removedLegs, requiresConfirmation: changes.length > 0 || input.removedRunners > 0 });
  if (preview.requiresConfirmation && !input.confirm) throw new PreviewOnly(preview);
  const rows = await recalculateAssessedEntries(tx, { raceId: input.raceId, assessed: toRecalculate, snapshot: after,
    snapshotVersion: input.snapshotVersion, courseVersionId: new Map([[input.classId, after.classes.find(row => row.id === input.classId)!.courseVersionId]]) });
  return { preview, recalculated: rows.length };
}

/** Varianterna för sträckorna `legs` för varje lag i nummerordning (rättvis fördelning, övriga sträckor oförändrade). */
async function replanLegVariants(tx: Transaction, config: RelayClassConfig, legs: ReadonlySet<number>): Promise<void> {
  if (legs.size === 0) return;
  const courses = await loadRelayLegCourses(tx, config);
  const plans = await loadRelayTeamVariantPlans(tx, config.classId);
  const teams = await tx.select({ id: schema.teams.id }).from(schema.teams)
    .where(and(eq(schema.teams.classId, config.classId), isNull(schema.teams.struckAt))).orderBy(asc(schema.teams.number));
  const done: Map<number, string>[] = [];
  for (const team of teams) {
    const current = new Map([...(plans.get(team.id) ?? new Map<number, string>())].filter(([leg]) => !legs.has(leg)));
    const planned = planRelayTeamVariants({ seed: relaySeedOf(config.classId), legs: courses, existing: done, mode: config.forking });
    for (const leg of legs) {
      const code = planned.get(leg) ?? null;
      if (code !== null) current.set(leg, code);
      await tx.update(schema.entries).set({ courseVariantCode: code })
        .where(and(eq(schema.entries.teamId, team.id), eq(schema.entries.relayLeg, leg)));
    }
    done.push(current);
  }
}

export type RelayClassEditResult = Failure | Confirmation | LegHasResult | { status: "saved"; response: RelayClassEditResponse };

/** "Ändra stafettklass": namn, sträckor (lägg till eller ta bort sist), startsätt och tider, bana och variant per sträcka. */
export async function editRelayClassAsAdmin(db: Database, input: Input, now = new Date()): Promise<RelayClassEditResult> {
  const intent = parseIntent(relayClassEditRequestSchema, input.request);
  const key = relayClassEditIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-class-edit:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  if (relayLegRuleProblem(relayLegRules(intent.legs))) return { status: "invalid-request" };
  try {
    return await mutate<RelayClassEditResponse, LegHasResult>(db, input, "CLASS_EDIT", intent,
      value => relayClassEditResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
        const config = (await loadRelayClassConfigs(tx, raceId)).get(intent.classId);
        const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name, courseVersionId: schema.classes.courseVersionId })
          .from(schema.classes).where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, raceId)));
        if (!config || !raceClass) return { status: "not-found" };
        if (intent.name !== raceClass.name && await classNameTaken(tx, raceId, intent.name, raceClass.id)) return { status: "duplicate-name" };
        // Steg 50: löpare per sträcka, växlingskontroll och utläsningssätt kan ändras även när lag finns. Avlästa sträckor
        // räknas om (med besked när någon byter status), en ny löparplats blir vakant och en borttagen löparplats får inte ha
        // ett resultat. En teamsprintlöpares sträckor (samma löpare på flera sträckor) kan inte bli parallella.
        const readoutMode = intent.readoutMode === undefined ? config.readoutMode : intent.readoutMode;
        const classEntries = await tx.select({ id: schema.entries.id, leg: schema.entries.relayLeg, legOrder: schema.entries.relayLegOrder,
          teamId: schema.entries.teamId, cardEntryId: schema.entries.relayCardEntryId, organisationName: schema.entries.organisationName })
          .from(schema.entries).where(and(eq(schema.entries.classId, raceClass.id), isNull(schema.entries.struckAt)));
        const sprintLegs = new Set(classEntries.flatMap(entry => entry.cardEntryId === null ? [] : [entry.leg,
          classEntries.find(owner => owner.id === entry.cardEntryId)?.leg]).filter((leg): leg is number => leg !== null && leg !== undefined));
        if (intent.legs.some(leg => leg.runners > 1 && sprintLegs.has(leg.leg))) return { status: "invalid-request" };
        if (sprintLegs.size > 0 && (readoutMode === null || (readoutMode === "LAST_LEG" && intent.changeoverCode === null))) {
          return { status: "invalid-request" };
        }
        const runnerChanges = intent.legs.flatMap(leg => {
          const old = config.legs.find(candidate => candidate.leg === leg.leg);
          return old && old.runners !== leg.runners ? [{ leg: leg.leg, from: old.runners, to: leg.runners }] : [];
        });
        const droppedRunners = classEntries.filter(entry => runnerChanges.some(change => change.leg === entry.leg &&
          (entry.legOrder ?? 1) > change.to));
        // Steg 56 (ADR-0174 beslut 10): klassens bana följer sträcka 1:s bana.
        const firstCourseId = intent.legs[0]?.courseId ?? null;
        const classVersion = firstCourseId === null ? raceClass.courseVersionId : await latestCourseVersion(tx, raceId, firstCourseId);
        if (!classVersion) return { status: "not-found" };
        const legCourses = await resolveLegCourses(tx, raceId, classVersion, intent.legs);
        if (legCourses === "not-found") return { status: "not-found" };
        if (legCourses === "invalid") return { status: "invalid-request" };
        const before = await loadRaceSnapshot(tx, raceId);
        const oldCount = config.legs.length, newCount = intent.legs.length;
        const removedLegs = Array.from({ length: Math.max(0, oldCount - newCount) }, (_, index) => newCount + index + 1);
        const addedLegs = Array.from({ length: Math.max(0, newCount - oldCount) }, (_, index) => oldCount + index + 1);
        // Borttagna sträckor: inte om någon löpare på dem har ett resultat. Övriga löpare tas bort med sin brickkoppling.
        const removed = [...(removedLegs.length === 0 ? [] : await tx.select({ id: schema.entries.id }).from(schema.entries)
          .where(and(eq(schema.entries.classId, raceClass.id), inArray(schema.entries.relayLeg, removedLegs)))),
          ...droppedRunners.map(entry => ({ id: entry.id }))];
        if (removed.length > 0) {
          const [withResult] = await tx.select({ value: count() }).from(schema.resultRevisions)
            .where(inArray(schema.resultRevisions.entryId, removed.map(row => row.id)));
          if ((withResult?.value ?? 0) > 0) return { status: "leg-has-result" };
          try {
            await purgeRows(tx, "entry", removed.map(row => row.id), { protect: ["result_revision", "card_readout", "raw_device_message",
              "result_finalization", "radio_punch", "unknown_readout_resolution", "device_ingest_outcome", "team"] });
          } catch (error) {
            if (error instanceof PurgeProtectedError) return { status: "leg-has-result" };
            throw error;
          }
          await tx.delete(schema.relayLegs).where(and(eq(schema.relayLegs.classId, raceClass.id), inArray(schema.relayLegs.leg, removedLegs)));
          if (removedLegs.length > 0) {
            await tx.delete(schema.relayLegs).where(and(eq(schema.relayLegs.classId, raceClass.id), inArray(schema.relayLegs.leg, removedLegs)));
          }
        } else if (removedLegs.length > 0) {
          await tx.delete(schema.relayLegs).where(and(eq(schema.relayLegs.classId, raceClass.id), inArray(schema.relayLegs.leg, removedLegs)));
        }
        // Fler löpare på en sträcka: varje lag får vakanta platser.
        const teamRows = await tx.select({ id: schema.teams.id, organisationName: schema.teams.organisationName }).from(schema.teams)
          .where(and(eq(schema.teams.classId, raceClass.id), isNull(schema.teams.struckAt)));
        for (const change of runnerChanges.filter(row => row.to > row.from)) {
          for (const team of teamRows) for (let order = change.from + 1; order <= change.to; order += 1) {
            await tx.insert(schema.entries).values({ raceId, classId: raceClass.id, teamId: team.id, relayLeg: change.leg, relayLegOrder: order,
              givenName: "Vakant", familyName: `sträcka ${change.leg}`, organisationName: team.organisationName, version: 1 });
          }
        }
        const replan = new Set<number>(addedLegs);
        for (const leg of intent.legs) {
          const row = relayLegRow(raceClass.id, raceId, leg, legCourses.get(leg.leg) ?? null);
          const old = config.legs.find(candidate => candidate.leg === leg.leg);
          if (!old) { await tx.insert(schema.relayLegs).values(row); continue; }
          // Banan som sträckan faktiskt springer: en sträcka som går från "klassens" till samma bana uttryckligen är oförändrad.
          if ((old.courseVersionId ?? raceClass.courseVersionId) !== (row.courseVersionId ?? classVersion) ||
            old.variantCode !== row.courseVariantCode) replan.add(leg.leg);
          await tx.update(schema.relayLegs).set({ startMethod: row.startMethod, startTime: row.startTime, courseVariantCode: row.courseVariantCode,
            courseVersionId: row.courseVersionId, restartAfterMinutes: row.restartAfterMinutes, runners: row.runners,
            changeoverRule: row.changeoverRule, approvalRule: row.approvalRule })
            .where(and(eq(schema.relayLegs.classId, raceClass.id), eq(schema.relayLegs.leg, leg.leg)));
        }
        await tx.update(schema.classes).set({ name: intent.name, courseVersionId: classVersion, relayRestartRanking: intent.restartRanking, relayForking: intent.forking,
          relayChangeoverCode: intent.changeoverCode, relayReadoutMode: readoutMode })
          .where(eq(schema.classes.id, raceClass.id));
        // Nya sträckor får en vakant löpare per lag, som på en sträcka utan löpare från Eventor.
        if (addedLegs.length > 0) {
          const teams = await tx.select({ id: schema.teams.id, organisationName: schema.teams.organisationName }).from(schema.teams)
            .where(and(eq(schema.teams.classId, raceClass.id), isNull(schema.teams.struckAt)));
          for (const team of teams) for (const leg of addedLegs) {
            await tx.insert(schema.entries).values({ raceId, classId: raceClass.id, teamId: team.id, relayLeg: leg, givenName: "Vakant",
              familyName: `sträcka ${leg}`, organisationName: team.organisationName, version: 1 });
          }
        }
        const updated = (await loadRelayClassConfigs(tx, raceId)).get(raceClass.id)!;
        await replanLegVariants(tx, updated, replan);
        await recomputeRelayStarts(tx, raceId, [raceClass.id]);
        const { preview, recalculated } = await recalculateChanged(tx, { raceId, classId: raceClass.id, className: intent.name, before,
          snapshotVersion: snapshotVersionAfter, confirm: intent.confirmResultChanges, addedLegs, removedLegs, removedRunners: removed.length });
        const response = relayClassEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
          classId: raceClass.id, request: intent, preview, recalculatedCount: recalculated, snapshotVersionAfter, changedAt: now.toISOString() });
        return { response, classId: raceClass.id, teamId: null };
      });
  } catch (error) {
    if (error instanceof PreviewOnly) return { status: "confirmation-required", preview: error.preview };
    throw error;
  }
}

export type RelayTeamEditResult = Failure | { status: "saved"; response: RelayTeamEditResponse };

/** "Ändra lag": namn, klubb och lagnummer (unikt i tävlingen). */
export async function editRelayTeamAsAdmin(db: Database, input: Input, now = new Date()): Promise<RelayTeamEditResult> {
  const intent = parseIntent(relayTeamEditRequestSchema, input.request);
  const key = relayTeamEditIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-team-edit:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return mutate(db, input, "TEAM_EDIT", intent, value => relayTeamEditResponseSchema.parse(value), now, async (tx, raceId, snapshotVersionAfter) => {
    const [team] = await tx.select({ id: schema.teams.id, classId: schema.teams.classId }).from(schema.teams)
      .where(and(eq(schema.teams.id, intent.teamId), eq(schema.teams.raceId, raceId), isNull(schema.teams.struckAt))).for("update");
    if (!team) return { status: "not-found" };
    const [taken] = await tx.select({ id: schema.teams.id }).from(schema.teams)
      .where(and(eq(schema.teams.raceId, raceId), eq(schema.teams.number, intent.number), ne(schema.teams.id, team.id)));
    if (taken) return { status: "conflict" };
    await tx.update(schema.teams).set({ number: intent.number, name: intent.name, organisationName: intent.organisationName })
      .where(eq(schema.teams.id, team.id));
    const response = relayTeamEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      teamId: team.id, request: intent, snapshotVersionAfter, changedAt: now.toISOString() });
    return { response, classId: team.classId, teamId: team.id };
  });
}

export type RelayTeamDidNotStartResult = Failure | { status: "saved"; response: RelayTeamDidNotStartResponse };

/** "Hela laget ej start": varje sträcka utan resultat får ej start (samma beslut som för en löpare). */
export async function setRelayTeamDidNotStartAsAdmin(db: Database, input: Input, now = new Date()): Promise<RelayTeamDidNotStartResult> {
  const intent = parseIntent(relayTeamDidNotStartRequestSchema, input.request);
  const key = relayTeamDidNotStartIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-team-dns:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return mutate(db, input, "TEAM_DID_NOT_START", intent, value => relayTeamDidNotStartResponseSchema.parse(value), now,
    async (tx, raceId, snapshotVersionAfter, actorAccountId) => {
      const [team] = await tx.select({ id: schema.teams.id, classId: schema.teams.classId }).from(schema.teams)
        .where(and(eq(schema.teams.id, intent.teamId), eq(schema.teams.raceId, raceId), isNull(schema.teams.struckAt)));
      if (!team) return { status: "not-found" };
      const legs = await tx.select({ id: schema.entries.id }).from(schema.entries)
        .where(and(eq(schema.entries.teamId, team.id), isNull(schema.entries.struckAt))).orderBy(asc(schema.entries.relayLeg));
      const results = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
        .where(inArray(schema.resultRevisions.entryId, legs.map(row => row.id)))).map(row => row.entryId));
      let didNotStart = 0;
      for (const leg of legs) {
        if (results.has(leg.id)) continue;
        const applied = await applyEntryDecision(tx, { raceId, entryId: leg.id, decision: { kind: "DID_NOT_START" }, expectedRevision: 0,
          requestId: randomUUID(), actorAccountId, decidedAt: now, snapshotVersion: snapshotVersionAfter });
        if (!applied?.ok) return { status: "conflict" };
        didNotStart += 1;
      }
      await synchronizeRelayClass(tx, raceId, team.classId, snapshotVersionAfter);
      const response = relayTeamDidNotStartResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
        teamId: team.id, request: intent, didNotStartCount: didNotStart, snapshotVersionAfter, changedAt: now.toISOString() });
      return { response, classId: team.classId, teamId: team.id };
    });
}

export type RelayLegVariantResult = Failure | Confirmation | { status: "saved"; response: RelayLegVariantResponse };

/** "Byt variant" på en sträcka i lagkortet. En avläst sträcka räknas om; byter den status visas först beskedet. */
export async function changeRelayLegVariantAsAdmin(db: Database, input: Input, now = new Date()): Promise<RelayLegVariantResult> {
  const intent = parseIntent(relayLegVariantRequestSchema, input.request);
  const key = relayLegVariantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-leg-variant:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  try {
    return await mutate<RelayLegVariantResponse>(db, input, "LEG_VARIANT", intent, value => relayLegVariantResponseSchema.parse(value), now,
      async (tx, raceId, snapshotVersionAfter) => {
        const [entry] = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, version: schema.entries.version,
          className: schema.classes.name }).from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
          .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.teamId, intent.teamId), eq(schema.entries.relayLeg, intent.leg),
            sql`coalesce(${schema.entries.relayLegOrder}, 1) = ${intent.legOrder}`, isNull(schema.entries.struckAt))).for("update");
        if (!entry) return { status: "not-found" };
        if (entry.version !== intent.expectedEntryVersion || entry.version >= MAX_VERSION) return { status: "conflict" };
        const config = (await loadRelayClassConfigs(tx, raceId)).get(entry.classId);
        const course = config && (await loadRelayLegCourses(tx, config)).find(row => row.leg === intent.leg);
        if (!course || !course.variants.some(variant => variant.code === intent.variantCode)) return { status: "invalid-request" };
        const before = await loadRaceSnapshot(tx, raceId);
        await tx.update(schema.entries).set({ courseVariantCode: intent.variantCode, version: entry.version + 1 })
          .where(eq(schema.entries.id, entry.id));
        const { preview, recalculated } = await recalculateChanged(tx, { raceId, classId: entry.classId, className: entry.className, before,
          snapshotVersion: snapshotVersionAfter, confirm: intent.confirmResultChanges, addedLegs: [], removedLegs: [], removedRunners: 0,
          entryIds: [entry.id] });
        const response = relayLegVariantResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
          teamId: intent.teamId, leg: intent.leg, request: intent, preview, recalculatedCount: recalculated, snapshotVersionAfter,
          changedAt: now.toISOString() });
        return { response, classId: entry.classId, teamId: intent.teamId };
      });
  } catch (error) {
    if (error instanceof PreviewOnly) return { status: "confirmation-required", preview: error.preview };
    throw error;
  }
}

export type RelayTeamRemovalResult = Failure | { status: "saved"; response: RelayTeamRemovalResponse };

/**
 * "Ta bort lag" (inget resultat på någon sträcka: laget, löparna och brickkopplingarna tas bort) eller "Stryk lag"
 * (laget har resultat: laget och löparna döljs i alla listor, brickorna släpps, revisionerna står kvar). Samma begäran
 * igen ger samma kvitto (auditposten). Klassens starter räknas om, eftersom en flygande omstart kan ha räknats från laget.
 */
export async function removeRelayTeamAsAdmin(db: Database, input: Input, now = new Date()): Promise<RelayTeamRemovalResult> {
  const intent = parseIntent(relayTeamRemovalRequestSchema, input.request);
  const key = relayTeamRemovalIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!intent || !key.success || key.data !== `relay-team-removal:${intent.requestId}` || !uuid.test(input.raceId)) return { status: "invalid-request" };
  const respond = (raceId: string, outcome: "DELETED" | "STRUCK" | "HAS_RESULT", replayed: boolean) => ({ status: "saved" as const,
    response: relayTeamRemovalResponseSchema.parse({ formatVersion: 1, replayed, requestId: intent.requestId, raceId, teamId: intent.teamId,
      request: intent, outcome, savedAt: now.toISOString() }) });
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    const [earlier] = await tx.select({ entityId: schema.auditEvents.entityId, after: schema.auditEvents.after }).from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.requestId, intent.requestId))).limit(1);
    if (earlier) {
      const outcome = (earlier.after as { outcome?: unknown } | null)?.outcome;
      if (earlier.entityId !== intent.teamId || (outcome !== "DELETED" && outcome !== "STRUCK")) return { status: "conflict" as const };
      return respond(raceId, outcome, true);
    }
    const [team] = await tx.select().from(schema.teams)
      .where(and(eq(schema.teams.id, intent.teamId), eq(schema.teams.raceId, raceId), isNull(schema.teams.struckAt))).for("update");
    if (!team) return { status: "not-found" as const };
    const entries = await tx.select({ id: schema.entries.id }).from(schema.entries).where(eq(schema.entries.teamId, team.id));
    const [withResult] = entries.length === 0 ? [{ value: 0 }] : await tx.select({ value: count() }).from(schema.resultRevisions)
      .where(inArray(schema.resultRevisions.entryId, entries.map(row => row.id)));
    const hasResult = (withResult?.value ?? 0) > 0;
    if (intent.mode === "DELETE" && hasResult) return respond(raceId, "HAS_RESULT", false);
    const before = { number: team.number, name: team.name, classId: team.classId, runners: entries.length };
    if (intent.mode === "DELETE") {
      try {
        await purgeRows(tx, "team", [team.id], { protect: ["result_revision", "card_readout", "raw_device_message", "result_finalization",
          "radio_punch", "unknown_readout_resolution", "device_ingest_outcome"] });
      } catch (error) {
        if (error instanceof PurgeProtectedError) return respond(raceId, "HAS_RESULT", false);
        throw error;
      }
    } else {
      await tx.update(schema.teams).set({ struckAt: now }).where(eq(schema.teams.id, team.id));
      if (entries.length > 0) {
        await tx.update(schema.entries).set({ struckAt: now }).where(inArray(schema.entries.id, entries.map(row => row.id)));
        await tx.update(schema.cardAssignments).set({ active: false })
          .where(and(inArray(schema.cardAssignments.entryId, entries.map(row => row.id)), eq(schema.cardAssignments.active, true)));
      }
    }
    const outcome = intent.mode === "DELETE" ? "DELETED" as const : "STRUCK" as const;
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "team", entityId: team.id, requestId: intent.requestId,
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, action: outcome === "DELETED" ? "RELAY_TEAM_DELETED_BY_ADMIN"
        : "RELAY_TEAM_STRUCK_BY_ADMIN", before, after: { outcome }, createdAt: now });
    await bumpReadoutPackageVersion(tx, raceId);
    await synchronizeRelayClass(tx, raceId, team.classId, race.snapshotVersion + 1);
    return respond(raceId, outcome, false);
  });
}
