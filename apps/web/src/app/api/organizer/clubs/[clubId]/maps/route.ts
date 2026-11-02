import { db } from "../../../../../../lib/db";
import { clubMapUploadRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194 beslut 2: ny karta med sin första version (filen som ström). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMapUploadRoute(db, request, clubId, null);
}
