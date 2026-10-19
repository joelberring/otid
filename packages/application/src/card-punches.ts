import { and, desc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { cardPunchListSchema, type CardPunchListDto } from "@o-tid/contracts";
import { cardPunchList } from "@o-tid/domain";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";

/**
 * Deltagarkortets stämplingslista (PLAN.md steg 27): den senaste avläsningen som hör till deltagaren (via en
 * resultatrevision), med alla stämplingar mot banan och tävlingsdagen. Checkstämplingen finns bara i den råa
 * nyttolasten och läses därifrån; inget skrivs. `null` när deltagaren inte har lästs av.
 */
export async function loadEntryCardPunches(tx: DbExecutor, raceId: string, entryId: string, timeZone: string):
  Promise<CardPunchListDto | null> {
  const [latest] = await tx.select({ readout: schema.cardReadouts, payload: schema.rawDeviceMessages.rawPayload })
    .from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .innerJoin(schema.rawDeviceMessages, eq(schema.rawDeviceMessages.id, schema.cardReadouts.rawMessageId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId),
      eq(schema.cardReadouts.raceId, raceId)))
    .orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
  if (!latest) return null;
  const { readout, payload } = latest;
  const check = typeof payload.checkPunchedAt === "string" && Number.isFinite(Date.parse(payload.checkPunchedAt))
    ? payload.checkPunchedAt : undefined;
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const list = cardPunchList({ checkPunchedAt: check, startPunchedAt: readout.startPunchedAt?.toISOString(),
    finishPunchedAt: readout.finishPunchedAt?.toISOString(), punches: readout.punches }, snapshot, entryId, timeZone);
  return cardPunchListSchema.parse({ readAt: readout.readAt.toISOString(), ...list });
}
