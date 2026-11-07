import { db } from "../../../../../../lib/db";
import { clubAccessRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0209 beslut C: "Vem ser vad" (PUT), klubbens inställning för arkivet oavsett Eventor. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return clubAccessRoute(db, request, (await context.params).clubId);
}
