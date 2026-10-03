import { db } from "../../../../../lib/db";
import { participantOwnResultsRoute } from "../../../../../lib/participant-entry-claim-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return participantOwnResultsRoute(db, request);
}
