import { db } from "../../../../../../lib/db";
import { outOfCompetitionCandidateListRoute } from "../../../../../../lib/out-of-competition-admin-route-handlers";
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> { return outOfCompetitionCandidateListRoute(db, request, (await params).raceId); }
