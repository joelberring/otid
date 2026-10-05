import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  rogainingChangeIdempotencyKeySchema, rogainingChangePreviewRequestSchema, rogainingChangePreviewResponseSchema,
  rogainingChangeRequestSchema, rogainingChangeResponseSchema, type RogainingChangePreviewRequest,
  type RogainingChangePreviewResponse, type RogainingChangeResponse, type RogainingSetup
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  defaultRogainingPoints, evaluateCardReadout, withRogainingSettings, type RaceSnapshot, type RogainingRules
} from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { assessReadOutEntries, normalizedReadout, recalculateAssessedEntries, type AssessedEntry } from "./result-reassessment";

/**
 * Rogaining (ADR-0170 beslut 5, PLAN.md steg 15): kontrollernas poäng och klassernas tidsgräns och straff.
 * Poängen hör till kontrollkoden i hela tävlingen (NULL = förvalet). Före sparande prövas de avlästa löparna i
 * berörda klasser med resultatmotorn; ändras någons status eller summa visas beskedet och arrangören bekräftar.
 * Sparandet räknar om berörda resultat med nya revisioner i samma transaktion (som Redigera bana).
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_VERSION = 2_147_483_647;

/** Underlaget för "Kontroller & poäng": kontrollerna (koderna som banorna använder) och klassernas regler. */
export async function loadRogainingSetup(tx: Executor, raceId: string, codes: readonly number[]): Promise<RogainingSetup> {
  const unique = [...new Set(codes)].sort((left, right) => left - right);
  const stored = unique.length === 0 ? [] : await tx.select({ code: schema.controls.code, points: schema.controls.points })
    .from(schema.controls).where(and(eq(schema.controls.raceId, raceId), inArray(schema.controls.code, unique)));
  const points = new Map(stored.map(row => [row.code, row.points]));
  const classes = await tx.select({ id: schema.classes.id, limit: schema.classes.rogainingTimeLimitSeconds,
    penalty: schema.classes.rogainingPenaltyPointsPerMinute }).from(schema.classes)
    .where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name), asc(schema.classes.id));
  return {
    controls: unique.map(code => ({ code, points: points.get(code) ?? defaultRogainingPoints(code), defaultPoints: defaultRogainingPoints(code) })),
    classes: classes.map(row => ({ classId: row.id, rules: row.limit === null || row.penalty === null ? null
      : { timeLimitMinutes: Math.round(row.limit / 60), penaltyPoints: row.penalty } }))
  };
}

type Change = {
  /** Kod → nytt sparat värde (null = förvalet). Bara koder som ändras. */
  points: Map<number, number | null>;
  /** Klass → nya regler. Bara klasser som ändras. */
  rules: Map<string, RogainingRules>;
  /** Klasser vars resultat kan påverkas. */
  classes: { id: string; name: string; courseVersionId: string }[];
};

/** Tolkar ändringen mot det som är sparat. Ger undefined om en kod eller klass inte finns, eller om inget ändras. */
async function planChange(tx: Transaction, raceId: string, intent: Pick<RogainingChangePreviewRequest, "controlPoints" | "classRules">,
  snapshot: RaceSnapshot): Promise<Change | undefined> {
  const codes = intent.controlPoints.map(row => row.code);
  const controls = codes.length === 0 ? [] : await tx.select({ code: schema.controls.code, points: schema.controls.points })
    .from(schema.controls).where(and(eq(schema.controls.raceId, raceId), inArray(schema.controls.code, codes)));
  if (controls.length !== codes.length) return undefined;
  const storedPoints = new Map(controls.map(row => [row.code, row.points]));
  const points = new Map<number, number | null>();
  for (const row of intent.controlPoints) {
    // Samma värde som förvalet sparas som förval, så att en senare ändrad kod inte ger ett gammalt fast värde.
    const value = row.points === defaultRogainingPoints(row.code) ? null : row.points;
    if (storedPoints.get(row.code) !== value) points.set(row.code, value);
  }
  const classById = new Map(snapshot.classes.map(raceClass => [raceClass.id, raceClass]));
  const rules = new Map<string, RogainingRules>();
  for (const row of intent.classRules) {
    const raceClass = classById.get(row.classId);
    if (!raceClass) return undefined;
    const next = { timeLimitSeconds: row.timeLimitMinutes * 60, penaltyPointsPerMinute: row.penaltyPoints };
    const current = raceClass.rogaining;
    if (!current || current.timeLimitSeconds !== next.timeLimitSeconds || current.penaltyPointsPerMinute !== next.penaltyPointsPerMinute) {
      rules.set(raceClass.id, next);
    }
  }
  if (points.size === 0 && rules.size === 0) return undefined;
  const codesByVersion = new Map(snapshot.courses.flatMap(course => course.versions.map(version =>
    [version.id, new Set(version.controls.map(control => control.controlCode))] as const)));
  const classes = snapshot.classes.filter(raceClass => rules.has(raceClass.id) ||
    (raceClass.rogaining !== undefined && [...points.keys()].some(code => codesByVersion.get(raceClass.courseVersionId)?.has(code))))
    .map(raceClass => ({ id: raceClass.id, name: raceClass.name, courseVersionId: raceClass.courseVersionId }));
  return { points, rules, classes };
}

const proposedSnapshot = (snapshot: RaceSnapshot, change: Change) => withRogainingSettings(snapshot, { points: change.points, classRules: change.rules });

/**
 * Beskedet: avlästa löpare som räknas om och de vars status eller summa ändras. Ett gällande manuellt beslut
 * (disk, godkännande m.fl.) ligger kvar, så då ändras inte statusen som visas.
 */
function previewResponse(raceId: string, snapshotVersion: number, assessed: readonly AssessedEntry[], snapshot: RaceSnapshot,
  proposed: RaceSnapshot): RogainingChangePreviewResponse {
  const changes = assessed.filter(row => row.recalculate).flatMap(row => {
    const readout = normalizedReadout(row.readout);
    const before = evaluateCardReadout(readout, snapshot).rogaining?.total;
    const after = evaluateCardReadout(readout, proposed).rogaining?.total;
    const afterStatus = row.outcome === "UNCHANGED" ? row.before : row.after;
    if (row.before === afterStatus && before === after) return [];
    return [{ entryId: row.entryId, displayName: row.displayName, className: row.className,
      before: { status: row.before, ...(before === undefined ? {} : { total: before }) },
      after: { status: afterStatus, ...(after === undefined ? {} : { total: after }) } }];
  });
  return rogainingChangePreviewResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion, readOutCount: assessed.length,
    notRecalculatedCount: assessed.filter(row => row.outcome === "NOT_RECALCULATED").length, changes,
    requiresConfirmation: changes.length > 0 });
}

export type RogainingChangePreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "too-large" }
  | { status: "ok"; response: RogainingChangePreviewResponse };

/** Läser bara: vad händer med de avlästa löparnas resultat med dessa poäng och regler? */
export async function previewRogainingChangeAsAdministrator(db: Database, input: Authentication & { request: unknown },
  now = new Date()): Promise<RogainingChangePreviewResult> {
  const parsed = rogainingChangePreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    if (race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" };
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const change = await planChange(tx, raceId, parsed.data, snapshot);
    if (!change) return { status: "invalid-request" };
    const proposed = proposedSnapshot(snapshot, change);
    const assessed = await assessReadOutEntries(tx, raceId, change.classes, snapshot, proposed);
    if (assessed === "too-large") return { status: "too-large" };
    return { status: "ok", response: previewResponse(raceId, race.snapshotVersion, assessed, snapshot, proposed) };
  }, { isolationLevel: "repeatable read" });
}

export type RogainingChangeResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "too-large" }
  | { status: "confirmation-required"; preview: RogainingChangePreviewResponse }
  | { status: "changed"; response: RogainingChangeResponse };

/**
 * Sparar poäng och regler. Ändras någon löpares status eller summa krävs `confirmResultChanges`; annars sparas
 * direkt. Tävlingens version ökar ett steg (avläsningens paket hämtas om) och berörda resultat räknas om.
 */
export async function changeRogainingAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RogainingChangeResult> {
  const parsed = rogainingChangeRequestSchema.safeParse(input.request);
  const key = rogainingChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `rogaining-change:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"rogaining-change:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.rogainingChangeRequests).where(eq(schema.rogainingChangeRequests.requestId, intent.requestId));
    if (prior) {
      const response = rogainingChangeResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId || response.replayed ||
          JSON.stringify(rogainingChangeRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "changed", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const before = await loadRaceSnapshot(tx, raceId);
    const change = await planChange(tx, raceId, intent, before);
    if (!change) return { status: "invalid-request" };
    if (change.classes.length > 0) {
      await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
        inArray(schema.entries.classId, change.classes.map(row => row.id)))).orderBy(asc(schema.entries.id)).for("update");
    }
    const proposed = proposedSnapshot(before, change);
    const assessed = await assessReadOutEntries(tx, raceId, change.classes, before, proposed);
    if (assessed === "too-large") return { status: "too-large" };
    const preview = previewResponse(raceId, race.snapshotVersion, assessed, before, proposed);
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    for (const [code, points] of change.points) {
      await tx.update(schema.controls).set({ points }).where(and(eq(schema.controls.raceId, raceId), eq(schema.controls.code, code)));
    }
    for (const [classId, rules] of change.rules) {
      await tx.update(schema.classes).set({ rogainingTimeLimitSeconds: rules.timeLimitSeconds,
        rogainingPenaltyPointsPerMinute: rules.penaltyPointsPerMinute })
        .where(and(eq(schema.classes.raceId, raceId), eq(schema.classes.id, classId)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));

    // Omräkning med de sparade poängen och reglerna. Databasen sätter varje ny revisions underlagshash.
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot, snapshotVersion: snapshotVersionAfter,
      courseVersionId: new Map(change.classes.map(row => [row.id, row.courseVersionId])) });
    const response = rogainingChangeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      request: intent, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, changedAt: now.toISOString() });
    await tx.insert(schema.rogainingChangeRequests).values({ requestId: intent.requestId, raceId,
      actorCredentialId: auth.principal.accessCredentialId, capability, request: intent, response, changedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "ROGAINING_CHANGED_BY_ADMIN",
      before: { snapshotVersion: race.snapshotVersion },
      after: { points: Object.fromEntries(change.points), rules: Object.fromEntries(change.rules), snapshotVersion: snapshotVersionAfter,
        recalculatedCount: recalculated.length }, createdAt: now });
    if (recalculated.length > 0) {
      await tx.insert(schema.auditEvents).values(recalculated.map(item => ({ raceId, entityType: "result_revision",
        entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_ROGAINING_CHANGE", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL" as const,
        actorId: auth.principal.accessCredentialId, requestId: intent.requestId,
        after: { entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION" }, createdAt: now })));
    }
    return { status: "changed", response };
  });
}
