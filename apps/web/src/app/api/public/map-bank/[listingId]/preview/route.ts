import { db } from "../../../../../../lib/db";
import { publicMapBankPreviewRoute } from "../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ listingId: string }> };

/** Etapp 3.2: publik förhandsvisningsbild (PNG) — endast när `showPreview === true`. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { listingId } = await context.params;
  return publicMapBankPreviewRoute(db, listingId, request);
}
