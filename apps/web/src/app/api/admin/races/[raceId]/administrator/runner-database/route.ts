import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

/** PLAN.md steg 29: löpardatabasen från Eventor (läget, uppdatera, radera). Bara administratören. */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "runner-database" });
}
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "runner-database" });
}
export async function DELETE(request: Request, context: { params: Promise<{ raceId: string }> }) {
  return raceAdministratorRoute(db, request, (await context.params).raceId, { kind: "runner-database" });
}
