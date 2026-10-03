import { db } from "../../../../../../lib/db";
import { didNotFinishWithdrawalAdminLoginRoute, didNotFinishWithdrawalAdminLogoutRoute, didNotFinishWithdrawalAdminSessionStatusRoute } from "../../../../../../lib/did-not-finish-withdrawal-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> { return didNotFinishWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId); }
export async function POST(request: Request, { params }: Context): Promise<Response> { return didNotFinishWithdrawalAdminLoginRoute(db, request, (await params).raceId); }
export async function DELETE(request: Request, { params }: Context): Promise<Response> { return didNotFinishWithdrawalAdminLogoutRoute(db, request, (await params).raceId); }
