import { db } from "../../../../../../../lib/db";
import { clubArchiveEntryRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; entryId: string }> };

/** ADR-0194: träningen (GET), ändra (PUT), ta bort (DELETE). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, entryId } = await context.params;
  return clubArchiveEntryRoute(db, request, clubId, entryId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, entryId } = await context.params;
  return clubArchiveEntryRoute(db, request, clubId, entryId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId, entryId } = await context.params;
  return clubArchiveEntryRoute(db, request, clubId, entryId);
}
