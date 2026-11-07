import type { MapAgreement, UsableClubMap } from "@o-tid/contracts";
import { clubAreaAllowed, mapAgreementIssues, type ClubAreaAccess } from "@o-tid/domain";
import type { ClubRole } from "./club-access";

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
