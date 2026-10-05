import type { RaceAdminCapability } from "./pairing-admin";

/**
 * ADR-0168 beslut 4, ändrat av ADR-0172 beslut 3. En administratör (MANAGE_RACE, som ett inloggat konto med
 * OWNER/ADMIN på eventet får) får göra allt i tävlingen, också allt som en funktionär får. En funktionär
 * (RACE_FUNCTIONARY) får bara det som kräver RACE_FUNCTIONARY: avläsning, direktanmälan av okänd bricka,
 * kvar i skogen, start och speaker. Allt annat kräver MANAGE_RACE och nekas funktionären.
 * Äldre funktionsvisa behörigheter gäller bara sin egen funktion.
 */
export function raceAdministratorAllowsAction(
  credentialCapability: string,
  requestedCapability: RaceAdminCapability
): boolean {
  return credentialCapability === requestedCapability || credentialCapability === "MANAGE_RACE";
}
