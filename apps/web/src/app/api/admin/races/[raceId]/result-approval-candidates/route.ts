import { db } from "../../../../../../lib/db";
import { resultApprovalCandidateListRoute } from "../../../../../../lib/result-approval-admin-route-handlers";
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> { return resultApprovalCandidateListRoute(db, request, (await params).raceId); }
