import { db } from "../../../../../../lib/db";
import { mapLayerProfilesRoute } from "../../../../../../lib/map-layer-profile-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219 (K6b): lagermappningsprofilerna (GET) och en ny eller ändrad profil (POST). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapLayerProfilesRoute(db, request, projectId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapLayerProfilesRoute(db, request, projectId);
}
