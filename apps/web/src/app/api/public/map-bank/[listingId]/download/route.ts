import { db } from "../../../../../../lib/db";
import { publicMapBankDownloadRoute } from "../../../../../../lib/public-map-bank-route-handlers";

type Context = { params: Promise<{ listingId: string }> };

/** Etapp 3.2: nedladdning av rå .ocd/.omap — endast när `accessMode === "OPEN_DOWNLOAD"`. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { listingId } = await context.params;
  return publicMapBankDownloadRoute(db, listingId);
}
