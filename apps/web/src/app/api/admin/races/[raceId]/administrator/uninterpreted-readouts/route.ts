import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** Steg 45: avläsningar vars tider inte gick att tolka – avläsningssidan skickar råramarna, administratören listar dem. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "uninterpreted-readouts" });
}

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "uninterpreted-readouts" });
}
