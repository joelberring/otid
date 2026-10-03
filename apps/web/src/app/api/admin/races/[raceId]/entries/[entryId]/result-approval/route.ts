import { db } from "../../../../../../../../lib/db";
import { authenticatedResultApprovalRoute } from "../../../../../../../../lib/result-approval-admin-route-handlers";
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> { const { raceId, entryId } = await params; return authenticatedResultApprovalRoute(db, request, raceId, entryId); }
