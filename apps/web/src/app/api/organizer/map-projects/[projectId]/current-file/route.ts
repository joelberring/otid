import { db } from "../../../../../../lib/db";
import { mapProjectCurrentFileRoute } from "../../../../../../lib/map-project-race-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägarens plan 2026-11-13: projektets aktuella karta (grundfilen med införda ändringar) som fil, för banläggningen. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectCurrentFileRoute(db, request, projectId);
}
