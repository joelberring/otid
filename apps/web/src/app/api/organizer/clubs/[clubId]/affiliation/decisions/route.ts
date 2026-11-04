import { db } from "../../../../../../../lib/db";
import { clubAffiliationDecisionRoute } from "../../../../../../../lib/club-affiliation-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0209: Bekräfta, Avböj eller Ta bort en medlem. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return clubAffiliationDecisionRoute(db, request, (await context.params).clubId);
}
