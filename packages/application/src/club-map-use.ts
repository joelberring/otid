import { and, eq } from "drizzle-orm";
import type { MapAgreement, MapUsageScope, UsableClubMap } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { clubAreaAllowed, mapAgreementIssues, type ClubAreaAccess } from "@o-tid/domain";
import { clubRoleAtLeast, type ClubRole } from "./club-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0210 beslut 7: "Välj karta från klubbarkivet" när en träning eller tävling skapas och i banläggningens start. Det enda
 * stället som avgör om kontot får använda klubbens karta i en egen tävling; "Använd igen" och kartan till tävlingen
 * (`saveClubMapVersionToRace`) frågar samma funktion. ADR-0209 beslut 5: ägare och administratörer får alltid; ledare och
 * medlemmar enligt klubbens "Kartbanken (kartfiler, Använd igen, nedladdning) får användas av" (förval alla medlemmar).
 * Kartans villkor stoppar inte men sägs (ett utgånget avtal, bara träning, avgift per utskrift).
 */
export interface ClubMapUseFacts {
  readonly role: ClubRole;
  readonly clubId: string;
  /** Klubbens inställning för kartbanken (`club_setting.map_bank_access`). */
  readonly mapBank: ClubAreaAccess;
}

export function mayUseClubMap(member: ClubMapUseFacts | undefined, map: { readonly mapId: string } & MapAgreement): boolean {
  // Kartans rättigheter stoppar inte (de sägs i listan, `clubMapUseIssues`); kartan måste ha ett id i klubben.
  if (member === undefined || map.mapId.length === 0) return false;
  return clubAreaAllowed(member.role, member.mapBank);
}

/** Villkoren att säga till om när kartan väljs (`date` är dagens datum, ÅÅÅÅ-MM-DD). */
export function clubMapUseIssues(map: MapAgreement, date: string): UsableClubMap["issues"] {
  const issues = mapAgreementIssues({ ownership: map.ownership, validUntil: map.validUntil, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
    noPublicDisplay: map.noPublicDisplay }, { date });
  return [...issues.filter((issue): issue is "EXPIRED" | "FEE_PER_PRINT" => issue === "EXPIRED" || issue === "FEE_PER_PRINT"),
    ...(map.trainingOnly ? ["TRAINING_ONLY" as const] : [])];
}

/**
 * Etapp 3.2: avgör om en klubbkartas användningsbegränsning (`usageScope`) stoppar användning.
 * - `ADMIN_ONLY`: kräver `ADMIN`/`OWNER` i klubben.
 * - `CLUB_ACTIVITIES_ONLY`: när en måltävling anges måste den höra till klubben (`raceBelongsToClub === true`).
 */
export function usageScopeBlockedReason(
  role: ClubRole,
  usageScope: MapUsageScope | undefined,
  raceBelongsToClub: boolean | undefined
): "ADMIN_ONLY" | "CLUB_ACTIVITIES_ONLY" | null {
  if (usageScope === "ADMIN_ONLY" && !clubRoleAtLeast(role, "ADMIN")) return "ADMIN_ONLY";
  if (usageScope === "CLUB_ACTIVITIES_ONLY" && raceBelongsToClub === false) return "CLUB_ACTIVITIES_ONLY";
  return null;
}

/**
 * Etapp 3.2: hör tävlingen till klubben? Sant om:
 * 1. Tävlingens arrangörsklubb (`race_organiser`) matchar klubbens Eventor-organisation (`club_setting.organisation_id`),
 * 2. Tävlingen skapats i klubbens terminsplanering (`club_plan_session`), eller
 * 3. Tävlingens träningsgrupp tillhör klubben (`training_group.club_id = clubId`).
 */
export async function raceBelongsToClub(tx: DbExecutor, clubId: string, raceId: string): Promise<boolean> {
  const [planned] = await tx.select({ id: schema.clubPlanSessions.id }).from(schema.clubPlanSessions)
    .where(and(eq(schema.clubPlanSessions.clubId, clubId), eq(schema.clubPlanSessions.raceId, raceId))).limit(1);
  if (planned) return true;

  const [setting] = await tx.select({ organisationId: schema.clubSettings.organisationId }).from(schema.clubSettings)
    .where(eq(schema.clubSettings.clubId, clubId)).limit(1);
  if (setting?.organisationId) {
    const [organiser] = await tx.select({ raceId: schema.raceOrganisers.raceId }).from(schema.raceOrganisers)
      .where(and(eq(schema.raceOrganisers.raceId, raceId), eq(schema.raceOrganisers.organisationId, setting.organisationId))).limit(1);
    if (organiser) return true;
  }

  const [groupLink] = await tx.select({ clubId: schema.trainingGroups.clubId }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.events.trainingGroupId))
    .where(and(eq(schema.races.id, raceId), eq(schema.trainingGroups.clubId, clubId))).limit(1);
  return !!groupLink;
}
