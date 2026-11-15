import { db } from "../../../../../../lib/db";
import { mapProjectPdfRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** Ägaren 2026-11-15: hela kartan som PDF (POST lägger jobbet, GET `?job=` hämtar PDF:en). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectPdfRoute(db, request, projectId);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectPdfRoute(db, request, projectId);
}
