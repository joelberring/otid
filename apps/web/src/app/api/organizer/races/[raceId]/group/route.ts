import { db } from "../../../../../../lib/db";
import { raceGroupRoute } from "../../../../../../lib/training-group-route-handlers";

/** Steg 68: tävlingen läggs till i eller tas ur en träningsgrupp. */
export async function PUT(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return raceGroupRoute(db, request, (await context.params).raceId);
}
