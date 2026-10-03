import { db } from "../../../../../../../../lib/db";
import { publicParticipantRouteWithdrawRoute } from "../../../../../../../../lib/public-participant-route-route-handlers";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) { return publicParticipantRouteWithdrawRoute(db, request, (await context.params).raceId); }
