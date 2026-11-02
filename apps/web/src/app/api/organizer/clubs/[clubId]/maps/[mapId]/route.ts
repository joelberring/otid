import { db } from "../../../../../../../lib/db";
import { clubMapUpdateRoute, clubMapUploadRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; mapId: string }> };

/** ADR-0194 beslut 2: kartans namn och rättigheter (PUT) och en ny version (POST, filen som ström). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapUpdateRoute(db, request, clubId, mapId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapUploadRoute(db, request, clubId, mapId);
}
