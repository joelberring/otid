import { db } from "../../../../../lib/db";
import { publicMapBankDetailRoute } from "../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ listingId: string }> };

/** Etapp 3.2: publik detaljvy för en karta i kartbanken. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { listingId } = await context.params;
  return publicMapBankDetailRoute(db, listingId);
}
