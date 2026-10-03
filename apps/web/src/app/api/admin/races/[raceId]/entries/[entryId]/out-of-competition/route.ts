import { db } from "../../../../../../../../lib/db";
import { authenticatedOutOfCompetitionRoute } from "../../../../../../../../lib/out-of-competition-admin-route-handlers";
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> { const { raceId, entryId } = await params; return authenticatedOutOfCompetitionRoute(db, request, raceId, entryId); }
