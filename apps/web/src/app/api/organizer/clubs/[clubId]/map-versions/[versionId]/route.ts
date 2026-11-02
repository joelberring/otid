import { db } from "../../../../../../../lib/db";
import { clubMapVersionRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; versionId: string }> };

/** ADR-0194: originalfilen (GET, strömmas) och versionens datum och anteckning (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionRoute(db, request, clubId, versionId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionRoute(db, request, clubId, versionId);
}
