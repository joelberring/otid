import { and, desc, eq, inArray } from "drizzle-orm";
import { unknownReadoutLinkDetailsSchema, type UnknownReadoutLinkDetails } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Användartestet 2026-11-12: vad en koppling av en okänd bricka ändrade för löparen (bricka före och efter, resultatet som
 * ersattes). Sparas som en auditpost för avläsningen och läses av deltagarkortets historik, så att historikraden "Okänd
 * bricka kopplad" kan säga vad som ersattes. Ingen ny tabell: auditposten är redan append-only.
 */
const ACTION = "UNKNOWN_READOUT_LINK_DETAILS";

type EntryResult = NonNullable<UnknownReadoutLinkDetails["replacedResult"]>;

/** Löparens senaste publicerade resultat i korthet (status och löptid), eller null. */
export async function currentEntryResult(tx: DbExecutor, raceId: string, entryId: string): Promise<EntryResult | null> {
  const [row] = await tx.select({ status: schema.resultRevisions.status, evaluation: schema.resultRevisions.evaluation })
    .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId),
      eq(schema.resultRevisions.published, true))).orderBy(desc(schema.resultRevisions.revision)).limit(1);
  return row ? entryResultOf(row) : null;
}

/** Status och löptid ur en lagrad revision. */
export function entryResultOf(row: { status: string; evaluation: unknown }): EntryResult {
  const elapsedMs = (row.evaluation as { elapsedMs?: unknown } | null)?.elapsedMs;
  return { status: row.status as EntryResult["status"],
    ...(typeof elapsedMs === "number" && Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? { elapsedMs } : {}) };
}

export async function recordLinkDetails(tx: DbExecutor, input: { raceId: string; readoutId: string; entryId: string;
  actorAccountId: string | null; requestId: string | null; details: UnknownReadoutLinkDetails; createdAt?: Date }): Promise<void> {
  await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "card_readout", entityId: input.readoutId,
    action: ACTION, actorKind: input.actorAccountId ? "USER_ACCOUNT" : null, actorId: input.actorAccountId, requestId: input.requestId,
    before: null, after: { entryId: input.entryId, ...unknownReadoutLinkDetailsSchema.parse(input.details) },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}) });
}

/** Kopplingens detaljer per avläsning för löparen (senaste posten gäller). Poster som inte går att tolka hoppas över. */
export async function loadLinkDetails(tx: DbExecutor, raceId: string, entryId: string, readoutIds: readonly string[]):
  Promise<Map<string, UnknownReadoutLinkDetails>> {
  const found = new Map<string, UnknownReadoutLinkDetails>();
  if (readoutIds.length === 0) return found;
  const rows = await tx.select({ readoutId: schema.auditEvents.entityId, after: schema.auditEvents.after }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.entityType, "card_readout"),
      eq(schema.auditEvents.action, ACTION), inArray(schema.auditEvents.entityId, [...readoutIds])))
    .orderBy(desc(schema.auditEvents.createdAt), desc(schema.auditEvents.id));
  for (const row of rows) {
    if (found.has(row.readoutId) || row.after?.entryId !== entryId) continue;
    const parsed = unknownReadoutLinkDetailsSchema.safeParse(Object.fromEntries(Object.entries(row.after).filter(([key]) => key !== "entryId")));
    if (parsed.success) found.set(row.readoutId, parsed.data);
  }
  return found;
}
