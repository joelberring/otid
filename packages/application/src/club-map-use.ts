import type { MapAgreement, UsableClubMap } from "@o-tid/contracts";
import { mapAgreementIssues } from "@o-tid/domain";
import { clubMembership, type ClubRole } from "./club-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0210 beslut 7: "Välj karta från klubbarkivet" när en träning eller tävling skapas och i banläggningens start. Det enda
 * stället som avgör om kontot får använda klubbens karta i en egen tävling; "Använd igen" och kartan till tävlingen
 * (`saveClubMapVersionToRace`) frågar samma funktion. I dag: alla medlemmar (läsare, administratörer och ägare). Kartans
 * villkor stoppar inte men sägs (ett utgånget avtal, bara träning, avgift per utskrift). Klubbens inställning för vem som får
 * använda kartbanken (grenen klubbtillhorighet) läggs till här.
 */
export interface ClubMapUseFacts {
  readonly role: ClubRole;
  readonly clubId: string;
}

export function mayUseClubMap(member: ClubMapUseFacts | undefined, map: { readonly mapId: string } & MapAgreement): boolean {
  // Kartans rättigheter stoppar inte i dag (de sägs i listan, `clubMapUseIssues`); kartan måste ha ett id i klubben.
  return member !== undefined && map.mapId.length > 0;
}

/** Villkoren att säga till om när kartan väljs (`date` är dagens datum, ÅÅÅÅ-MM-DD). */
export function clubMapUseIssues(map: MapAgreement, date: string): UsableClubMap["issues"] {
  const issues = mapAgreementIssues({ ownership: map.ownership, validUntil: map.validUntil, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
    noPublicDisplay: map.noPublicDisplay }, { date });
  return [...issues.filter((issue): issue is "EXPIRED" | "FEE_PER_PRINT" => issue === "EXPIRED" || issue === "FEE_PER_PRINT"),
    ...(map.trainingOnly ? ["TRAINING_ONLY" as const] : [])];
}

/** Kontots roll i klubben för `mayUseClubMap` (undefined utan medlemskap). */
export async function clubMapUseFacts(tx: DbExecutor, accountId: string, clubId: string): Promise<ClubMapUseFacts | undefined> {
  const member = await clubMembership(tx, { accountId, clubId }, "none");
  return member ? { role: member.role, clubId } : undefined;
}
