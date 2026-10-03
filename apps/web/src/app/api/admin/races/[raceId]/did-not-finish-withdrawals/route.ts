import { db } from "../../../../../../lib/db";
import { didNotFinishWithdrawalListRoute } from "../../../../../../lib/did-not-finish-withdrawal-admin-route-handlers";
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> { return didNotFinishWithdrawalListRoute(db, request, (await params).raceId); }
