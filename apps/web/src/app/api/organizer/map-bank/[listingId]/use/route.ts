import { db } from "../../../../../../lib/db";
import { usePublicMapListingRoute } from "../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ listingId: string }> };

/** Etapp 3.2: "Använd i ny träning" från publika kartbanken (inloggad + Origin/CSRF). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { listingId } = await context.params;
  return usePublicMapListingRoute(db, request, listingId);
}
