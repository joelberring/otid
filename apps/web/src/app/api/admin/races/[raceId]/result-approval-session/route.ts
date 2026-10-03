import { db } from "../../../../../../lib/db";
import { resultApprovalAdminLoginRoute, resultApprovalAdminLogoutRoute, resultApprovalAdminSessionStatusRoute } from "../../../../../../lib/result-approval-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> { return resultApprovalAdminSessionStatusRoute(db, request, (await params).raceId); }
export async function POST(request: Request, { params }: Context): Promise<Response> { return resultApprovalAdminLoginRoute(db, request, (await params).raceId); }
export async function DELETE(request: Request, { params }: Context): Promise<Response> { return resultApprovalAdminLogoutRoute(db, request, (await params).raceId); }
