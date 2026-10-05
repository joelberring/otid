import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

/** Kartbilden för georeferensen i arbetsytan, även innan den är georefererad. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "race-map-image" });
}
