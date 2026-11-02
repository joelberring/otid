import { db } from "../../../../../../../../lib/db";
import { clubMapVersionMoveRoute } from "../../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; versionId: string }> };

/** ADR-0194 beslut 2: flytta versionen till en annan karta eller en ny. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionMoveRoute(db, request, clubId, versionId);
}
