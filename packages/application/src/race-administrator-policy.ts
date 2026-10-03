import type { RaceAdminCapability } from "./pairing-admin";

/**
 * ADR-0168: två behörighetsnivåer. En administratör (MANAGE_RACE, som ett
 * inloggat konto med OWNER/ADMIN på eventet får) får göra allt i tävlingen.
 * Äldre funktionsvisa behörigheter gäller fortfarande bara sin egen funktion.
 */
export function raceAdministratorAllowsAction(
  credentialCapability: RaceAdminCapability,
  requestedCapability: RaceAdminCapability
): boolean {
  return credentialCapability === requestedCapability || credentialCapability === "MANAGE_RACE";
}
