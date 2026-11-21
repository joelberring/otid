import { db } from "../../../../../../lib/db";
import { mapProjectDecisionsRoute } from "../../../../../../lib/map-project-decision-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Kartritarens beslut om grundkartans förslag (0132): GET (ägarna), POST när ett utkast läggs in (föreslå eller mer). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectDecisionsRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectDecisionsRoute(db, request, projectId);
}
