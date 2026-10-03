import { db } from "../../../../lib/db";
import { routePublicationConsentDecisionRoute, routePublicationConsentStateRoute } from "../../../../lib/route-upload-route-handlers";

export const runtime = "nodejs";
export async function GET(request: Request) { return routePublicationConsentStateRoute(db, request); }
export async function POST(request: Request) { return routePublicationConsentDecisionRoute(db, request); }
