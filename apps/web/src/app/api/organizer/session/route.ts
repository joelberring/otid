import { db } from "../../../../lib/db";
import {
  organizerSessionStatusRoute
} from "../../../../lib/organizer-account-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return organizerSessionStatusRoute(db, request);
}
