import { db } from "../../../../../../../lib/db";
import { clubArchiveSummariesRoute } from "../../../../../../../lib/club-check-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0196: banfilernas sammanfattningar räknas om ("Kontrollera alla kartor igen"). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubArchiveSummariesRoute(db, request, clubId);
}
