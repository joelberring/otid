import { db } from "../../../../../../lib/db";
import { mapProjectPrimarySourcesRoute } from "../../../../../../lib/map-project-primary-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Huvudkällorna (K4c, 0143): GET (medlemmarna), POST en ny markering (föreslå eller mer). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectPrimarySourcesRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectPrimarySourcesRoute(db, request, projectId);
}
