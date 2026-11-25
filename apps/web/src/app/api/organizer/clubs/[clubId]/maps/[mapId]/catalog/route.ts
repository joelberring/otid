import { db } from "../../../../../../../../lib/db";
import { clubMapCatalogRoute } from "../../../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ clubId: string; mapId: string }> };

/** Etapp 3.2: publicera/uppdatera/avpublicera klubbkarta i publika kartbanken. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapCatalogRoute(db, request, clubId, mapId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapCatalogRoute(db, request, clubId, mapId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId, mapId } = await context.params;
  return clubMapCatalogRoute(db, request, clubId, mapId);
}
