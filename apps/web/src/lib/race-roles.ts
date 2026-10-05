import type { authenticatePairingAdminSession, PairingAdminAuthenticationResult } from "@o-tid/application";
import type { Database } from "@o-tid/database";

/**
 * Behörighet på en tävling (ADR-0168 beslut 4, ändrat av ADR-0172 beslut 3).
 *
 * - ADMIN: kontot har OWNER/ADMIN på eventet och får göra allt i tävlingen (sessionens behörighet MANAGE_RACE).
 * - FUNCTIONARY: kontot har rollen Funktionär (RACE_FUNCTIONARY): avläsning, direktanmälan av okänd bricka,
 *   kvar i skogen, start och speaker. En administratör har alltid också funktionärens rättigheter.
 *
 * Alla adminroutes kontrollerar rollen med `requireRaceRole` innan något annat görs. Tjänsterna i
 * `@o-tid/application` kontrollerar samma behörighet igen, och databasen tillåter funktionärens behörighet bara
 * i de journaler som funktionären får skriva.
 */
export type RaceRole = "ADMIN" | "FUNCTIONARY";

const CAPABILITY = { ADMIN: "MANAGE_RACE", FUNCTIONARY: "RACE_FUNCTIONARY" } as const;

/**
 * Det funktionären får göra, som åtgärd i `/api/admin/races/{raceId}/administrator/…` och HTTP-metod.
 * Allt som inte står här kräver administratör. Den här tabellen är den enda platsen som avgör det.
 */
export const FUNCTIONARY_ROUTES: Readonly<Record<string, readonly string[]>> = {
  /** Tävlingssessionen: läsa och logga ut. */
  session: ["GET", "DELETE"],
  /** Arbetsytans ögonblicksbild: klasser och deltagare (startlista, direktanmälan, kvar i skogen). */
  "transfer-candidates": ["GET"],
  /** Avläsningen i webbläsaren: paketet och inskickade avläsningar. */
  "readout-package": ["GET"],
  readouts: ["POST"],
  /** Okända brickor: läsa och direktanmäla (koppling till befintlig deltagare kräver administratör i tjänsten). */
  "unknown-readout-resolution": ["GET", "POST"],
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

/**
 * Den gemensamma kontrollen: sessionen måste gälla tävlingen och ha rollen (eller administratör).
 * Funktionärens session får "forbidden" (403) för allt som kräver administratör.
 */
export async function requireRaceRole(
  authenticate: typeof authenticatePairingAdminSession,
  db: Database,
  input: { sessionToken: string | null; csrfCookie: string | null; csrfHeader: string | null; raceId: string; write: boolean },
  role: RaceRole
): Promise<PairingAdminAuthenticationResult> {
  const result = await authenticate(db, { sessionToken: input.sessionToken, csrfCookie: input.csrfCookie,
    csrfHeader: input.csrfHeader, raceId: input.raceId, capability: CAPABILITY[role], requireCsrf: input.write });
  if (result.status !== "authenticated") return result;
  // Dubbelkoll av sessionens behörighet: bara administratören eller (för funktionärens åtgärder) funktionären.
  const capability = result.principal.capability;
  const allowed = capability === "MANAGE_RACE" || (role === "FUNCTIONARY" && capability === "RACE_FUNCTIONARY");
  if (result.principal.raceId !== input.raceId || !allowed) return { status: "forbidden" };
  return result;
}
