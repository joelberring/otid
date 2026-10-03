import { db } from "../../../../../../lib/db";
import { didNotFinishCandidateListRoute } from "../../../../../../lib/did-not-finish-admin-route-handlers";
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> { return didNotFinishCandidateListRoute(db, request, (await params).raceId); }
