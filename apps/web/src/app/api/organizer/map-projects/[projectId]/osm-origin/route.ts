import { db } from "../../../../../../lib/db";
import { mapProjectOsmOriginRoute } from "../../../../../../lib/map-project-primary-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ursprunget för kartans orörda objekt ur inlagda utkast (K4c): vilka som kom från OpenStreetMap. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectOsmOriginRoute(db, request, projectId);
}
