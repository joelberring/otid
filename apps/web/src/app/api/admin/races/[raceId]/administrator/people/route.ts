import { db } from "../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../lib/race-administrator-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

/** Personer med behörighet på tävlingen (ADR-0172 beslut 3). */
export async function GET(request: Request, { params }: Context) {
  return raceAdministratorRoute(db, request, (await params).raceId, { kind: "people" });
}
export async function POST(request: Request, { params }: Context) {
  return raceAdministratorRoute(db, request, (await params).raceId, { kind: "people" });
}
export async function DELETE(request: Request, { params }: Context) {
  return raceAdministratorRoute(db, request, (await params).raceId, { kind: "people" });
}
