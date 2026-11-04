import { db } from "../../../../lib/db";
import { organizerVerifyEmailRoute } from "../../../../lib/organizer-account-route-handlers";

/** ADR-0186/ADR-0205: bekräftelselänken och lösenordet som personen väljer. */
export async function POST(request: Request): Promise<Response> {
  return organizerVerifyEmailRoute(db, request);
}
