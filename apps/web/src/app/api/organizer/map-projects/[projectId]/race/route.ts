import { db } from "../../../../../../lib/db";
import { mapProjectRaceRoute } from "../../../../../../lib/map-project-race-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägarens plan 2026-11-13: projektets aktuella karta blir tävlingens kartfil (koppla, eller ta in kartans ändringar). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectRaceRoute(db, request, projectId);
}
