import { eq } from "drizzle-orm";
import type { BingoMode, CourseSettingLevel, RaceType } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { requireCourseSettingAccess } from "./course-setting-access";
import { requireRaceRole, type RaceRole } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * Tävlingsraden i telefonbredd (ADR-0227 tillägg 2026-11-18): det raden behöver veta om arrangemanget för den inloggade.
 * Rollen avgörs med samma kontroll som arbetsytans anrop (`requireRaceRole`); banläggningens nivå med banläggningens
 * (`requireCourseSettingAccess`). Bara läsning; vad varje roll får använda avgör servern som förut vid varje anrop.
 */
export interface RaceNavigationContext {
  raceId: string;
  eventName: string;
  raceName: string;
  raceDate: string;
  timeZone: string;
  raceType: RaceType;
  role: RaceRole;
  /** Banläggningens behörighet (administratören har alltid EDIT); saknas = ingen. */
  courseSetting?: CourseSettingLevel | undefined;
  /** Övning i mobilen (bingo, Sänka skepp, virtuella kontroller), om den är påslagen. */
  bingo?: { enabled: boolean; mode: BingoMode } | undefined;
}

/** Arrangemangets namn, datum, tidszon, typ och övning, utan behörighetskontroll (anroparen har prövat rollen). */
export async function loadRaceNavigationFacts(db: DbExecutor, raceId: string)
  : Promise<Omit<RaceNavigationContext, "raceId" | "role" | "courseSetting"> | undefined> {
  const [race] = await db.select({ eventName: schema.events.name, raceName: schema.races.name, raceDate: schema.races.raceDate,
    timeZone: schema.events.timeZone, raceType: schema.races.raceType, bingoEnabledAt: schema.bingoRaces.enabledAt, bingoMode: schema.bingoRaces.mode })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .leftJoin(schema.bingoRaces, eq(schema.bingoRaces.raceId, schema.races.id))
    .where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  return { eventName: race.eventName, raceName: race.raceName, raceDate: race.raceDate, timeZone: race.timeZone, raceType: race.raceType,
    ...(race.bingoEnabledAt !== null && race.bingoMode !== null ? { bingo: { enabled: true, mode: race.bingoMode } } : {}) };
}

/** Undefined när kontot saknar roll på tävlingen (också den som bara har banläggningen). */
export async function loadRaceNavigationContext(db: DbExecutor, input: { raceId: string; sessionToken: string | null }, now = new Date())
  : Promise<RaceNavigationContext | undefined> {
  if (!input.sessionToken) return undefined;
  const auth = await requireRaceRole(db, { raceId: input.raceId, sessionToken: input.sessionToken, role: "FUNCTIONARY" }, now);
  if (auth.status !== "authenticated" || auth.principal.raceId !== input.raceId) return undefined;
  const facts = await loadRaceNavigationFacts(db, input.raceId);
  if (!facts) return undefined;
  const role = auth.principal.role;
  let courseSetting: CourseSettingLevel | undefined = role === "ADMIN" ? "EDIT" : undefined;
  if (!courseSetting) {
    const access = await requireCourseSettingAccess(db, { raceId: input.raceId, sessionToken: input.sessionToken, required: "MAP" }, now);
    if (access.status === "authenticated" && access.principal.raceId === input.raceId) courseSetting = access.principal.level;
  }
  return { raceId: input.raceId, ...facts, role, ...(courseSetting ? { courseSetting } : {}) };
}
