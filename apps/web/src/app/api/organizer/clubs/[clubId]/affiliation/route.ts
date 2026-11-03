import { db } from "../../../../../../lib/db";
import { clubAffiliationRoute } from "../../../../../../lib/club-affiliation-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0209: kopplingen till Eventor, bekräftelserna (GET) och "Vem ser vad" (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return clubAffiliationRoute(db, request, (await context.params).clubId);
}
export async function PUT(request: Request, context: Context): Promise<Response> {
  return clubAffiliationRoute(db, request, (await context.params).clubId);
}
