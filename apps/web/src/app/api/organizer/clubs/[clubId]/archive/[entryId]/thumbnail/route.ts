import { db } from "../../../../../../../../lib/db";
import { clubEntryThumbnailRoute } from "../../../../../../../../lib/club-check-route-handlers";

type Context = { params: Promise<{ clubId: string; entryId: string }> };

/** ADR-0196: träningens bild (GET) och den nyritade bilden (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, entryId } = await context.params;
  return clubEntryThumbnailRoute(db, request, clubId, entryId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, entryId } = await context.params;
  return clubEntryThumbnailRoute(db, request, clubId, entryId);
}
