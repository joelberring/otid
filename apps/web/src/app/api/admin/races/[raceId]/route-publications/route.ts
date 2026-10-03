import { db } from "../../../../../../lib/db";
import { publicParticipantRoutePublicationStateRoute, publicParticipantRouteReleaseRoute } from "../../../../../../lib/public-participant-route-route-handlers";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) { return publicParticipantRoutePublicationStateRoute(db, request, (await context.params).raceId); }
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) { return publicParticipantRouteReleaseRoute(db, request, (await context.params).raceId); }
