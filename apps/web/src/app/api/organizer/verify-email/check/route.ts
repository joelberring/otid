import { db } from "../../../../../lib/db";
import { organizerVerifyEmailCheckRoute } from "../../../../../lib/organizer-account-route-handlers";

/** ADR-0205: vad bekräftelselänken leder till innan personen skriver något. */
export async function POST(request: Request): Promise<Response> {
  return organizerVerifyEmailCheckRoute(db, request);
}
