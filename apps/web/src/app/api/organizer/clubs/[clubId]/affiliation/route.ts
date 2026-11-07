import { db } from "../../../../../../lib/db";
import { clubAffiliationRoute } from "../../../../../../lib/club-affiliation-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0209: kopplingen till Eventor, bekräftelserna och "Vem ser vad" (GET; Vem ser vad sparas på …/access). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return clubAffiliationRoute(db, request, (await context.params).clubId);
}
