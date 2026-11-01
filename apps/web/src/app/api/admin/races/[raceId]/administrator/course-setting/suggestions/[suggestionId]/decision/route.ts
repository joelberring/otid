import { db } from "../../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../../lib/race-administrator-route-handlers";

/** Steg 66: godkänn helt, delvis eller avböj ett förslag. */
export async function POST(request: Request, context: { params: Promise<{ raceId: string; suggestionId: string }> }) {
  const { raceId, suggestionId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "course-setting-suggestion-decision", suggestionId });
}
