import { db } from "../../../../../../../../lib/db";
import { clubMapVersionCheckRoute } from "../../../../../../../../lib/club-check-route-handlers";

type Context = { params: Promise<{ clubId: string; versionId: string }> };

/** ADR-0196: kartversionens bild (GET) och kontrollen med bilden (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionCheckRoute(db, request, clubId, versionId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, versionId } = await context.params;
  return clubMapVersionCheckRoute(db, request, clubId, versionId);
}
