import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  markRemainingDidNotStartIdempotencyKeySchema, markRemainingDidNotStartRequestSchema, markRemainingDidNotStartResponseSchema,
  remainingRunnersResponseSchema, type MarkRemainingDidNotStartResponse, type RemainingRunnersResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { classifyRemainingRunners } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { applyEntryDecision } from "./entry-status";
import { sha256Hex } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md steg 25: "Markera alla kvar i skogen som ej start" (Resultat, efter tävlingen). Löpare utan någon
 * resultatrevision (ingen avläsning, inget beslut) delas av domänen (`classifyRemainingRunners`): utan tecken på start
 * blir de ej start; med radiostämpling eller avprickad start listas de som "Saknas i mål – kontrollera" och lämnas.
 * Varje ej start är en vanlig revision i statusflödet (`applyEntryDecision`, samma som `setEntryStatus`) med ett
 * begärans-id härlett ur åtgärdens id och löparen, så att samma åtgärd två gånger inte gör något nytt.
 */
type Authentication = RaceSessionProof;

interface RemainingRunner {
  readonly entryId: string; readonly name: string; readonly className: string; readonly organisationName: string | null;
  readonly cardNumber: string | null; readonly evidence?: "RADIO" | "START_CHECKIN";
}

async function loadRemainingRunners(tx: DbExecutor, raceId: string): Promise<{ didNotStart: RemainingRunner[]; missingAtFinish: RemainingRunner[] }> {
  const entries = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    organisationName: schema.entries.organisationName, className: schema.classes.name }).from(schema.entries)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId)).where(eq(schema.entries.raceId, raceId))
    .orderBy(asc(schema.classes.name), asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(10_001);
  if (entries.length > 10_000) throw new Error("För många deltagare");
  const withResult = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.raceId, raceId))).map((row) => row.entryId));
  const cards = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
  const cardByEntry = new Map(cards.map((row) => [row.entryId, row.cardNumber]));
  const radioCards = new Set((await tx.selectDistinct({ cardNumber: schema.radioPunches.cardNumber }).from(schema.radioPunches)
    .where(eq(schema.radioPunches.raceId, raceId))).map((row) => row.cardNumber));
  const checkins = await tx.selectDistinctOn([schema.startCheckinRevisions.entryId], { entryId: schema.startCheckinRevisions.entryId,
    startState: schema.startCheckinRevisions.startState }).from(schema.startCheckinRevisions)
    .where(eq(schema.startCheckinRevisions.raceId, raceId))
    .orderBy(asc(schema.startCheckinRevisions.entryId), desc(schema.startCheckinRevisions.revision));
  const started = new Set(checkins.filter((row) => row.startState === "STARTED").map((row) => row.entryId));
  const radioPunched = (entryId: string) => { const card = cardByEntry.get(entryId); return card !== undefined && radioCards.has(card); };
  const classified = classifyRemainingRunners(entries.map((entry) => ({ entryId: entry.id, hasResult: withResult.has(entry.id),
    radioPunched: radioPunched(entry.id), startCheckedIn: started.has(entry.id) })));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const runner = (entryId: string, evidence?: "RADIO" | "START_CHECKIN"): RemainingRunner => {
    const entry = byId.get(entryId)!;
    return { entryId, name: `${entry.givenName} ${entry.familyName}`, className: entry.className, organisationName: entry.organisationName,
      cardNumber: cardByEntry.get(entryId) ?? null, ...(evidence ? { evidence } : {}) };
  };
  return { didNotStart: classified.didNotStart.map((id) => runner(id)),
    missingAtFinish: classified.missingAtFinish.map((id) => runner(id, radioPunched(id) ? "RADIO" : "START_CHECKIN")) };
}

export type RemainingRunnersResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" }
  | { status: "ok"; response: RemainingRunnersResponse };

/** Förhandsvisningen: vilka blir ej start och vilka saknas i mål. */
export async function previewRemainingRunnersAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<RemainingRunnersResult> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForSnapshot(tx, auth.principal.raceId);
    const remaining = await loadRemainingRunners(tx, auth.principal.raceId);
    return { status: "ok", response: remainingRunnersResponseSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId, ...remaining }) };
  }, { isolationLevel: "repeatable read" });
}

/** Begärans-id för en löpares ej start inom åtgärden: ett UUID (version 5-form) ur åtgärdens id och löparen. */
export function remainingDecisionRequestId(requestId: string, entryId: string): string {
  const hex = sha256Hex(`remaining-did-not-start:${requestId}:${entryId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${"89ab"[Number.parseInt(hex[16]!, 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type MarkRemainingDidNotStartResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" }
  | { status: "saved"; response: MarkRemainingDidNotStartResponse };

/** Markerar de bekräftade löparna som ej start, om de fortfarande saknar resultat och inte har startat. */
export async function markRemainingDidNotStartAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<MarkRemainingDidNotStartResult> {
  const parsed = markRemainingDidNotStartRequestSchema.safeParse(input.request);
  const key = markRemainingDidNotStartIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `remaining-did-not-start:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  const decidedAt = new Date(now);
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, decidedAt, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    const decisionIds = new Map(intent.entryIds.map((entryId) => [entryId, remainingDecisionRequestId(intent.requestId, entryId)]));
    const earlier = await tx.select({ entryId: schema.resultRevisions.entryId, revision: schema.resultRevisions.revision,
      requestId: schema.resultRevisions.requestId }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.requestId, [...decisionIds.values()])));
    const done = new Map(earlier.filter((row) => decisionIds.get(row.entryId) === row.requestId).map((row) => [row.entryId, row.revision]));
    const candidates = new Set((await loadRemainingRunners(tx, raceId)).didNotStart.map((runner) => runner.entryId));
    const marked: { entryId: string; revision: number }[] = [];
    let skippedCount = 0, created = 0;
    for (const entryId of intent.entryIds) {
      const previous = done.get(entryId);
      if (previous !== undefined) { marked.push({ entryId, revision: previous }); continue; }
      if (!candidates.has(entryId)) { skippedCount += 1; continue; }
      const applied = await applyEntryDecision(tx, { raceId, entryId, decision: { kind: "DID_NOT_START" }, expectedRevision: 0,
        requestId: decisionIds.get(entryId)!, actorAccountId: auth.principal.accountId, decidedAt });
      if (!applied?.ok) { skippedCount += 1; continue; }
      marked.push({ entryId, revision: applied.revision.revision }); created += 1;
    }
    if (created > 0) {
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, requestId: intent.requestId,
        action: "REMAINING_MARKED_DID_NOT_START", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, before: null,
        after: { markedCount: created, skippedCount, entryIds: marked.map((row) => row.entryId) }, createdAt: decidedAt });
    }
    return { status: "saved", response: markRemainingDidNotStartResponseSchema.parse({ formatVersion: 1, replayed: created === 0 && marked.length > 0,
      requestId: intent.requestId, raceId, request: intent, marked, skippedCount }) };
  });
}
