import { db } from "../../../../../../../../lib/db";
import { authenticatedDidNotFinishWithdrawalRoute } from "../../../../../../../../lib/did-not-finish-withdrawal-admin-route-handlers";
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> { const { raceId, entryId } = await params; return authenticatedDidNotFinishWithdrawalRoute(db, request, raceId, entryId); }
