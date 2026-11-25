import { db } from "../../../../../../lib/db";
import { mapProjectCatalogRoute } from "../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Etapp 3.2: publicera/uppdatera/avpublicera kartprojekt i publika kartbanken. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectCatalogRoute(db, request, projectId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectCatalogRoute(db, request, projectId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectCatalogRoute(db, request, projectId);
}
