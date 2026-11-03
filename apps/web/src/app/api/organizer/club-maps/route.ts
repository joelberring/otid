import { db } from "../../../../lib/db";
import { usableClubMapsRoute } from "../../../../lib/club-map-route-handlers";

/** ADR-0210: kartorna i kontots klubbar att välja i en ny tävling ("Välj karta från klubbarkivet"). */
export async function GET(request: Request): Promise<Response> {
  return usableClubMapsRoute(db, request);
}
