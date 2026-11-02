import { and, eq, isNotNull, isNull, lte, min } from "drizzle-orm";
import {
  publicTimingRequestSchema, publicTimingResponseSchema, startListPublicationContentSchema, type PublicTimingResponse,
  type StartListPublicationContent
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { parseRaceClock, publicMapVisible, publicVariantVisible, type PublicMapTiming, type PublicVariantTiming } from "@o-tid/domain";
import { lockRaceForMutation } from "./concurrency";
import { coursesArePublic } from "./course-secrecy";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0186: före start. Variantens bokstav (startlistan, stafettlistan och startlistans IOF XML) och kartbilden (vägvalen,
 * GPS-rutterna och kontrollkartan) är hemliga publikt före start, om inte arrangören valt annat under Publicera. Arrangören
 * och funktionärerna ser alltid allt. Banhemligheten (ADR-0176) gäller som förut ovanpå.
 */
export interface PublicTiming {
  readonly variant: PublicVariantTiming;
  readonly map: PublicMapTiming;
}

export async function loadPublicTiming(tx: DbExecutor, raceId: string): Promise<PublicTiming | undefined> {
  const [race] = await tx.select({ variant: schema.races.publicVariantTiming, map: schema.races.publicMapTiming })
    .from(schema.races).where(eq(schema.races.id, raceId));
  return race;
}

/**
 * Har tävlingen startat? Den första fasta starttiden, en masstart eller omstart i en stafett eller tävlingens "Första start"
 * (Inställningar) har passerat, eller något har redan lästs ut eller stämplats på en radiokontroll. Utan något av det
 * (fri start utan tider) räknas tävlingen som startad först vid första avläsningen.
 */
export async function raceHasStarted(tx: DbExecutor, raceId: string, now: Date): Promise<boolean> {
  const [race] = await tx.select({ raceDate: schema.races.raceDate, firstStartTime: schema.races.firstStartTime,
    timeZone: schema.events.timeZone }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.races.id, raceId));
  if (!race) return false;
  if (race.firstStartTime) {
    const first = parseRaceClock(race.raceDate, race.firstStartTime, race.timeZone);
    if (first && Date.parse(first) <= now.getTime()) return true;
  }
  const [entry] = await tx.select({ first: min(schema.entries.fixedStartTime) }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt), isNotNull(schema.entries.fixedStartTime)));
  if (entry?.first && entry.first.getTime() <= now.getTime()) return true;
  const [leg] = await tx.select({ raceId: schema.relayLegs.raceId }).from(schema.relayLegs)
    .where(and(eq(schema.relayLegs.raceId, raceId), lte(schema.relayLegs.startTime, now))).limit(1);
  if (leg) return true;
  const [readout] = await tx.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts)
    .where(eq(schema.cardReadouts.raceId, raceId)).limit(1);
  if (readout) return true;
  const [punch] = await tx.select({ raceId: schema.radioPunches.raceId }).from(schema.radioPunches)
    .where(eq(schema.radioPunches.raceId, raceId)).limit(1);
  return punch !== undefined;
}

/** Får kartbilden visas publikt nu (före start-valet och banhemligheten; avtalet i träningsgruppen kontrolleras separat)? */
export async function publicMapAllowedNow(tx: DbExecutor, raceId: string, now = new Date()): Promise<boolean> {
  const timing = await loadPublicTiming(tx, raceId);
  if (!timing) return false;
  if (timing.map === "ON_PUBLISH") return true;
  return publicMapVisible({ timing: timing.map, coursesPublic: await coursesArePublic(tx, raceId), started: await raceHasStarted(tx, raceId, now) });
}

/** Läget för varianterna i en publik lista: valet och om banorna är publika (läses en gång per lista). */
export interface PublicVariantPolicy {
  readonly timing: PublicVariantTiming;
  readonly coursesPublic: boolean;
  readonly now: Date;
}

export async function loadPublicVariantPolicy(tx: DbExecutor, raceId: string, now: Date): Promise<PublicVariantPolicy> {
  const timing = (await loadPublicTiming(tx, raceId))?.variant ?? "AFTER_START";
  return { timing, coursesPublic: timing === "ALWAYS" ? true : await coursesArePublic(tx, raceId), now };
}

/**
 * Startlistan publikt: varianten tas bort för löpare som inte har startat. `hidden` säger om någon variant togs bort (sidan
 * säger då att varianten visas efter start, och startlistans IOF XML ges inte ut).
 */
export function hideUnstartedVariants(content: StartListPublicationContent, policy: PublicVariantPolicy)
  : { content: StartListPublicationContent; hidden: boolean } {
  let hidden = false;
  const classes = content.classes.map(row => ({ ...row, entries: row.entries.map(entry => {
    if (entry.courseVariantCode === undefined) return entry;
    if (publicVariantVisible({ ...policy, startTime: entry.fixedStartTime })) return entry;
    hidden = true;
    const copy = { ...entry };
    delete copy.courseVariantCode;
    return copy;
  }) }));
  return { content: hidden ? startListPublicationContentSchema.parse({ ...content, classes }) : content, hidden };
}

export type PublicTimingResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "saved"; response: PublicTimingResponse };

/** Publicera → "Före start": arrangörens val för varianten och kartan. Samma val igen ändrar inget (ingen auditpost). */
export async function setPublicTimingAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<PublicTimingResult> {
  const parsed = publicTimingRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    const before = await loadPublicTiming(tx, raceId);
    if (!before) return { status: "not-found" } as const;
    const after = { variant: parsed.data.variant ?? before.variant, map: parsed.data.map ?? before.map };
    if (after.variant !== before.variant || after.map !== before.map) {
      await tx.update(schema.races).set({ publicVariantTiming: after.variant, publicMapTiming: after.map })
        .where(eq(schema.races.id, raceId));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "PUBLIC_TIMING_SAVED_BY_ADMIN",
        actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, before: { ...before }, after, createdAt: now });
    }
    return { status: "saved", response: publicTimingResponseSchema.parse({ formatVersion: 1, raceId, publicTiming: after }) } as const;
  });
}
