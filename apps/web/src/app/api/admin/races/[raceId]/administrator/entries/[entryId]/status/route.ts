import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

type Params = { params: Promise<{ raceId: string; entryId: string }> };

/** Löparens status (ADR-0173 beslut 1): läget och de beslut som går att fatta. */
export async function GET(request: Request, context: Params) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "entry-status", entryId });
}

/** Ett beslut om löparen: ej start, brutit, disk, utom tävlan, deltog utan tid, godkänn, ändrad tid eller ta bort. */
export async function POST(request: Request, context: Params) {
  const { raceId, entryId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "entry-status", entryId });
}
