import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  startDrawIdempotencyKeySchema, startDrawPreviewRequestSchema, startDrawPreviewResponseSchema, startDrawRequestSchema,
  startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawPreviewResponse, type StartDrawResponse,
  type StartDrawSetupResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { drawStartTimes, StartDrawError, withProposedEntryVariants, withProposedStartTimes, type StartDrawResult } from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { assessReadOutEntries, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry } from "./result-reassessment";
import { loadDrawClasses, loadDrawEntries, loadDrawPlans, type DrawBasisClass, type DrawBasisEntry, type DrawPlan } from "./start-draw-basis";
import { planVariantDistribution, writeEntryVariants } from "./course-variants";

/**
 * Lottning (PLAN.md steg 9): välj startsätt per klass och lotta en eller flera
 * klasser på en gång. Förhandsvisningen läser bara. Sparandet ger samma lottning
 * (samma frö och samma tävlingsläge), skriver starttider och vakanta tider,
 * pekar klasserna på lottningen och räknar om avlästa löpare vars underlag ändras.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_VERSION = 2_147_483_647;
const DEFAULT_INTERVAL_MINUTES = 2;

type Settings = {
  expectedSnapshotVersion: number; firstStartTime: string; clubSeparation: boolean;
  classes: { classId: string; method: "FREE" | "MINUTE" | "MASS"; intervalMinutes: number;
    vacancies: { kind: "COUNT" | "PERCENT"; value: number } }[];
};

function randomSeed(): number {
  let seed = 0;
  while (seed === 0) seed = randomBytes(4).readUInt32BE(0);
  return seed;
}

async function raceMetadata(tx: Transaction, raceId: string) {
  const [row] = await tx.select({ raceDate: schema.races.raceDate, timeZone: schema.events.timeZone }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!row) throw new Error("Loppets metadata saknas");
  return row;
}

async function activeCards(tx: Transaction, raceId: string): Promise<Map<string, string>> {
  const rows = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
  const cards = new Map<string, string>();
  const multiple = new Set<string>();
  for (const row of rows) { if (cards.has(row.entryId)) multiple.add(row.entryId); cards.set(row.entryId, row.cardNumber); }
  for (const entryId of multiple) cards.delete(entryId);
  return cards;
}

const iso = (ms: number) => new Date(ms).toISOString();
const hasStartTimes = (raceClass: DrawBasisClass, entries: readonly DrawBasisEntry[]) =>
  raceClass.startDrawId !== null || entries.some(entry => entry.classId === raceClass.id && entry.fixedStartTime !== null);

type Computed = {
  draw: StartDrawResult; classes: DrawBasisClass[]; entries: DrawBasisEntry[]; plans: Map<string, DrawPlan>;
  entryTimes: Map<string, string | null>; changedEntryIds: Set<string>; variants: Map<string, string>; assessed: AssessedEntry[];
  preview: StartDrawPreviewResponse;
};

/** Lottar enligt inställningarna mot tävlingens aktuella läge och prövar avlästa löpare. */
async function compute(tx: Transaction, raceId: string, snapshotVersion: number, settings: Settings, seed: number, lock: boolean)
  : Promise<Computed | "not-found" | "too-large" | "invalid-request"> {
  const classes = await loadDrawClasses(tx, raceId);
  const loaded = await loadDrawEntries(tx, raceId, lock);
  if (loaded === "too-large") return "too-large";
  const entries = loaded;
  const byId = new Map(classes.map(row => [row.id, row]));
  if (settings.classes.some(row => !byId.has(row.classId))) return "not-found";
  const selected = new Map(settings.classes.map(row => [row.classId, row]));
  const plans = await loadDrawPlans(tx, classes);
  const occupied = classes.filter(row => !selected.has(row.id) && row.startRule === "FIXED" && row.firstControlCode !== null)
    .flatMap(row => [
      ...entries.filter(entry => entry.classId === row.id && entry.fixedStartTime !== null).map(entry => entry.fixedStartTime!.getTime()),
      ...(plans.get(row.id)?.slots.map(slot => slot.startTime.getTime()) ?? [])
    ].map(startMs => ({ classId: row.id, firstControlCode: row.firstControlCode!, startMs })));
  let draw: StartDrawResult;
  try {
    draw = drawStartTimes({ seed, firstStartMs: Date.parse(settings.firstStartTime), clubSeparation: settings.clubSeparation, occupied,
      classes: settings.classes.flatMap(row => row.method === "FREE" ? [] : [{ classId: row.classId, name: byId.get(row.classId)!.name,
        firstControlCode: byId.get(row.classId)!.firstControlCode, method: row.method, intervalMinutes: row.intervalMinutes,
        vacancies: row.vacancies, runners: entries.filter(entry => entry.classId === row.classId)
          .map(entry => ({ entryId: entry.id, club: entry.organisationName })) }]) });
  } catch (error) {
    if (error instanceof StartDrawError) return error.code === "TOO_LARGE" ? "too-large" : "invalid-request";
    throw error;
  }
  const drawnByClass = new Map(draw.classes.map(row => [row.classId, row]));
  const entryTimes = new Map<string, string | null>();
  for (const result of draw.classes) for (const slot of result.slots) if (slot.entryId !== null) entryTimes.set(slot.entryId, iso(slot.startMs));
  for (const row of settings.classes.filter(item => item.method === "FREE")) {
    for (const entry of entries.filter(item => item.classId === row.classId)) entryTimes.set(entry.id, null);
  }
  const startRuleOf = (classId: string) => selected.get(classId)!.method === "FREE" ? "PUNCH" as const : "FIXED" as const;
  const changedEntryIds = new Set(entries.filter(entry => entryTimes.has(entry.id) &&
    ((entry.fixedStartTime?.toISOString() ?? null) !== entryTimes.get(entry.id) || byId.get(entry.classId)!.startRule !== startRuleOf(entry.classId)))
    .map(entry => entry.id));
  const snapshot = await loadRaceSnapshot(tx, raceId);
  // Gafflade klasser: löpare utan variant får en med lottningens frö (ADR-0169 beslut 2).
  const variants = await planVariantDistribution(tx, raceId, settings.classes.map(row => row.classId), seed, snapshot);
  const proposed = withProposedEntryVariants(withProposedStartTimes(snapshot, {
    classes: settings.classes.map(row => ({ classId: row.classId, startRule: startRuleOf(row.classId) })), entryTimes }), variants);
  const assessedAll = await assessReadOutEntries(tx, raceId, settings.classes.map(row => byId.get(row.classId)!), snapshot, proposed);
  if (assessedAll === "too-large") return "too-large";
  // Bara löpare vars starttid, startsätt eller variant ändras behöver prövas och räknas om.
  const assessed = assessedAll.filter(row => changedEntryIds.has(row.entryId) || variants.has(row.entryId));
  const cards = await activeCards(tx, raceId);
  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  const slotEntry = (entryId: string | null) => {
    const entry = entryId === null ? undefined : entryById.get(entryId);
    return entry ? { id: entry.id, name: `${entry.givenName} ${entry.familyName}`, club: entry.organisationName,
      card: cards.get(entry.id) ?? null, variantCode: variants.get(entry.id) ?? entry.courseVariantCode } : null;
  };
  const sortedSettings = [...settings.classes].sort((a, b) => byId.get(a.classId)!.name.localeCompare(byId.get(b.classId)!.name, "sv-SE"));
  const previewClasses = sortedSettings.map(row => {
    const raceClass = byId.get(row.classId)!;
    const result = drawnByClass.get(row.classId);
    const slots = !result ? [] : result.slots.map(slot => ({ startTime: iso(slot.startMs), entry: slotEntry(slot.entryId) }));
    if (row.method === "MASS") slots.sort((a, b) => (a.entry?.name ?? "").localeCompare(b.entry?.name ?? "", "sv-SE"));
    const replaces = row.method === "FREE"
      ? entries.some(entry => entry.classId === row.classId && entry.fixedStartTime !== null)
      : hasStartTimes(raceClass, entries);
    return { classId: row.classId, className: raceClass.name, method: row.method, firstStartTime: result ? iso(result.firstStartMs) : null,
      intervalMinutes: row.intervalMinutes, vacancyCount: result?.vacancyCount ?? 0, replacesStartTimes: replaces, slots };
  });
  const summary = summarizeAssessment(assessed);
  const replacesStartTimes = previewClasses.some(row => row.replacesStartTimes);
  const preview = startDrawPreviewResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion,
    timeZone: (await raceMetadata(tx, raceId)).timeZone, seed, classes: previewClasses,
    startGroups: draw.groups.map(group => {
      const minuteClasses = group.classIds.map(id => drawnByClass.get(id));
      return { firstControlCode: group.firstControlCode, classNames: group.classIds.map(id => byId.get(id)!.name),
        alternating: group.classIds.length === 2 && minuteClasses.every(row => row?.method === "MINUTE" && row.intervalMinutes === 2) };
    }),
    replacesStartTimes, ...summary, requiresConfirmation: summary.requiresConfirmation || replacesStartTimes });
  return { draw, classes, entries, plans, entryTimes, changedEntryIds, variants, assessed, preview };
}

export type StartDrawSetupResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "too-large" }
  | { status: "ok"; response: StartDrawSetupResponse };

/** Klasserna med nuvarande startsätt och lottningens inställningar. */
export async function loadStartDrawSetupAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<StartDrawSetupResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const metadata = await raceMetadata(tx, raceId);
    const classes = await loadDrawClasses(tx, raceId);
    const entries = await loadDrawEntries(tx, raceId, false);
    if (entries === "too-large") return { status: "too-large" };
    const plans = await loadDrawPlans(tx, classes);
    const firstStarts = [...plans.values()].map(plan => plan.firstStartTime.getTime());
    return { status: "ok", response: startDrawSetupResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: race.snapshotVersion,
      raceDate: metadata.raceDate, timeZone: metadata.timeZone,
      firstStartTime: firstStarts.length === 0 ? null : iso(Math.min(...firstStarts)),
      classes: classes.map(row => {
        const plan = plans.get(row.id);
        return { id: row.id, name: row.name, courseName: row.courseName, firstControlCode: row.firstControlCode,
          entryCount: entries.filter(entry => entry.classId === row.id).length,
          method: row.startRule === "PUNCH" ? "FREE" : plan?.method ?? "MINUTE",
          intervalMinutes: plan ? plan.intervalSeconds / 60 : DEFAULT_INTERVAL_MINUTES,
          vacancies: { kind: "COUNT", value: plan?.vacancyCount ?? 0 }, hasStartTimes: hasStartTimes(row, entries) };
      }) }) };
  }, { isolationLevel: "repeatable read" });
}

export type StartDrawPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: StartDrawPreviewResponse };

/** Läser bara: hur blir startlistan, vilka klasser får nya tider och vad händer med avlästa löpare? */
export async function previewStartDrawAsAdministrator(db: Database, input: Authentication & { request: unknown },
  now = new Date()): Promise<StartDrawPreviewResult> {
  const parsed = startDrawPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    if (race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" };
    const computed = await compute(tx, raceId, race.snapshotVersion, parsed.data, randomSeed(), false);
    if (typeof computed === "string") return { status: computed };
    return { status: "ok", response: computed.preview };
  }, { isolationLevel: "repeatable read" });
}

export type StartDrawCommitResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "confirmation-required"; preview: StartDrawPreviewResponse }
  | { status: "drawn"; response: StartDrawResponse };

async function writeDraw(tx: Transaction, input: { raceId: string; requestId: string; computed: Computed;
  settings: Settings; actorCredentialId: string; snapshotVersionBefore: number; response: StartDrawResponse; now: Date; seed: number }) {
  const { computed, raceId } = input;
  const [saved] = await tx.insert(schema.startDrawRequests).values({ requestId: input.requestId, raceId,
    actorCredentialId: input.actorCredentialId, capability, seed: input.seed, request: input.response.request, response: input.response,
    snapshotVersionBefore: input.snapshotVersionBefore, snapshotVersionAfter: input.snapshotVersionBefore + 1, drawnAt: input.now }).returning();
  if (!saved) throw new Error("Lottningen kunde inte sparas");
  for (const result of computed.draw.classes) {
    await tx.insert(schema.startDrawClasses).values({ drawId: saved.id, raceId, classId: result.classId, method: result.method,
      firstStartTime: new Date(result.firstStartMs), intervalSeconds: result.intervalMinutes * 60, vacancyCount: result.vacancyCount });
    const slots = result.slots.map((slot, position) => ({ drawId: saved.id, classId: result.classId, position,
      startTime: new Date(slot.startMs), entryId: slot.entryId }));
    for (let offset = 0; offset < slots.length; offset += 1_000) await tx.insert(schema.startDrawSlots).values(slots.slice(offset, offset + 1_000));
  }
  for (const row of input.settings.classes) {
    const drawn = row.method !== "FREE";
    await tx.update(schema.classes).set({ startRule: drawn ? "FIXED" : "PUNCH", startDrawId: drawn ? saved.id : null })
      .where(and(eq(schema.classes.id, row.classId), eq(schema.classes.raceId, raceId)));
  }
  const entries = computed.entries.filter(entry => computed.changedEntryIds.has(entry.id));
  if (entries.some(entry => entry.version >= MAX_VERSION)) throw new Error("Deltagarens version är slut");
  for (const entry of entries) {
    const time = computed.entryTimes.get(entry.id)!;
    await tx.update(schema.entries).set({ fixedStartTime: time === null ? null : new Date(time), version: entry.version + 1 })
      .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.raceId, raceId), eq(schema.entries.version, entry.version)));
  }
  await writeEntryVariants(tx, raceId, computed.variants);
  return saved;
}

/**
 * Sparar lottningen. Kräver `confirmChanges` när befintliga starttider ersätts eller
 * någon avläst löpares status ändras; annars sparas direkt.
 */
export async function commitStartDrawAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<StartDrawCommitResult> {
  const parsed = startDrawRequestSchema.safeParse(input.request);
  const key = startDrawIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `start-draw:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"start-draw:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.startDrawRequests).where(eq(schema.startDrawRequests.requestId, intent.requestId));
    if (prior) {
      const response = startDrawResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "drawn", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const computed = await compute(tx, raceId, race.snapshotVersion, intent, intent.seed, true);
    if (typeof computed === "string") return { status: computed };
    if (computed.preview.requiresConfirmation && !intent.confirmChanges) return { status: "confirmation-required", preview: computed.preview };
    const snapshotVersionAfter = race.snapshotVersion + 1;
    const response = startDrawResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId, request: intent,
      classCount: intent.classes.length, entryCount: computed.draw.classes.reduce((sum, row) => sum + row.slots.filter(slot => slot.entryId !== null).length, 0),
      vacancyCount: computed.draw.classes.reduce((sum, row) => sum + row.vacancyCount, 0),
      recalculatedCount: computed.assessed.filter(row => row.recalculate).length,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, drawnAt: now.toISOString() });
    const saved = await writeDraw(tx, { raceId, requestId: intent.requestId, computed, settings: intent, seed: intent.seed,
      actorCredentialId: auth.principal.accessCredentialId, snapshotVersionBefore: race.snapshotVersion, response, now });
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));
    // Omräkning mot det sparade läget; databasen sätter varje ny revisions underlagshash.
    const courseVersions = new Map(computed.classes.map(row => [row.id, row.courseVersionId]));
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed: computed.assessed,
      snapshot: await loadRaceSnapshot(tx, raceId), snapshotVersion: snapshotVersionAfter, courseVersionId: courseVersions });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "start_draw", entityId: saved.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "START_DRAW_COMMITTED",
      before: { snapshotVersion: race.snapshotVersion },
      after: { snapshotVersion: snapshotVersionAfter, classIds: intent.classes.map(row => row.classId),
        changedEntryCount: computed.changedEntryIds.size, recalculatedCount: recalculated.length }, createdAt: now });
    if (recalculated.length > 0) {
      await tx.insert(schema.auditEvents).values(recalculated.map(item => ({ raceId, entityType: "result_revision",
        entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_START_DRAW", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL" as const,
        actorId: auth.principal.accessCredentialId, requestId: intent.requestId,
        after: { entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION" }, createdAt: now })));
    }
    return { status: "drawn", response };
  });
}
