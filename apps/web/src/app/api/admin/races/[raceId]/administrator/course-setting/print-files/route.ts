import { db } from "../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../lib/race-administrator-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

/** Ägaren 2026-11-10: utskrifternas sparade PDF:er (läsa: den som ser banläggningen; spara: den som ändrar). */
export async function GET(request: Request, context: Context) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-files" });
}

/** En egen PDF (application/pdf) eller ett klart tryckjobbs PDF ({ fromJobId }). */
export async function POST(request: Request, context: Context) {
  const { raceId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-print-files" });
}
