import type { RaceRole } from "@o-tid/application";

/**
 * Behörighet på en tävling (ADR-0168 beslut 4, ändrat av ADR-0172 beslut 3).
 *
 * - ADMIN: kontot har OWNER/ADMIN på eventet och får göra allt i tävlingen.
 * - FUNCTIONARY: kontot har rollen Funktionär: avläsning, direktanmälan av okänd bricka,
 *   kvar i skogen, start och speaker. En administratör har alltid också funktionärens rättigheter.
 *
 * Alla adminroutes kontrollerar rollen med `requireRaceRole` (`@o-tid/application`) och kontots session innan
 * något annat görs. Tjänsterna kontrollerar samma behörighet igen.
 */

/**
 * Det funktionären får göra, som åtgärd i `/api/admin/races/{raceId}/administrator/…` och HTTP-metod.
 * Allt som inte står här kräver administratör. Den här tabellen är den enda platsen som avgör det.
 */
export const FUNCTIONARY_ROUTES: Readonly<Record<string, readonly string[]>> = {
  /** Sessionen: läsa rollen och logga ut. */
  session: ["GET", "DELETE"],
  /** Arbetsytans ögonblicksbild: klasser och deltagare (startlista, direktanmälan, kvar i skogen). */
  "transfer-candidates": ["GET"],
  /** Avläsningen i webbläsaren: paketet och inskickade avläsningar. */
  "readout-package": ["GET"],
  readouts: ["POST"],
  /** Okända brickor: läsa och direktanmäla (koppling till befintlig deltagare kräver administratör i tjänsten). */
  "unknown-readout-resolution": ["GET", "POST"],
  /** Direktanmälan på avläsningssidan, även köad offline (PLAN.md steg 25). */
  "readout-registrations": ["POST"],
  /** Kvar i skogen: läsa, registrera och ta tillbaka återkomst. */
  "forest-watch": ["GET"],
  "manual-return": ["POST"],
  "manual-return-withdrawal": ["POST"],
  /** Start: startläget (startat, ej start). */
  "start-correction": ["POST"],
  /** Speaker och kontrollvyn: senaste avläsningar och stafettens lag. */
  "speaker-board": ["GET"],
  relay: ["GET"]
};

/** Rollen som en åtgärd kräver. */
export function raceRoleFor(action: string, method: string): RaceRole {
  return FUNCTIONARY_ROUTES[action]?.includes(method) ? "FUNCTIONARY" : "ADMIN";
}

/** Dubbelkoll av rollkontrollens svar: rätt tävling och (för administratörens åtgärder) administratörens roll. */
export function principalAllows(principal: { raceId: string; role: RaceRole }, raceId: string, role: RaceRole): boolean {
  return principal.raceId === raceId && (role === "FUNCTIONARY" || principal.role === "ADMIN");
}
