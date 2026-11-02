import { db } from "../../../../lib/db";
import { organizerVerifyEmailRoute } from "../../../../lib/organizer-account-route-handlers";

/** ADR-0186: bekräftelselänken och lösenordet från registreringen. */
export async function POST(request: Request): Promise<Response> {
  return organizerVerifyEmailRoute(db, request);
}
