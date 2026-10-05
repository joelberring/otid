import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Karta och vägval (PLAN.md steg 16): tillståndet, ny kartbild (PNG/JPEG) och borttagning. */
const handle = async (request: Request, context: { params: Promise<{ raceId: string }> }) =>
  raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "race-map" });
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
