import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

/** ADR-0214: länken till kartritaren – läget (utan nyckeln). */
export async function GET(request: Request, context: Context) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-map-link" });
}

/** Ny länk ("Dela med kartritaren", "Skapa ny länk"); den förra stängs av. Svaret har nyckeln, den enda gången. */
export async function POST(request: Request, context: Context) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-map-link" });
}

/** "Stäng av länken". */
export async function DELETE(request: Request, context: Context) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-map-link" });
}
