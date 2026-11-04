import { db } from "../../../../lib/db";
import { organisationSearchRoute } from "../../../../lib/club-affiliation-route-handlers";

/** ADR-0209: sökning i klubblistan (Eventors organisationer) för inloggade. */
export async function GET(request: Request): Promise<Response> { return organisationSearchRoute(db, request); }
