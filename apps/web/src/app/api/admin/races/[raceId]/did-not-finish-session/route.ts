import { db } from "../../../../../../lib/db";
import { didNotFinishAdminLoginRoute, didNotFinishAdminLogoutRoute, didNotFinishAdminSessionStatusRoute } from "../../../../../../lib/did-not-finish-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> { return didNotFinishAdminSessionStatusRoute(db, request, (await params).raceId); }
export async function POST(request: Request, { params }: Context): Promise<Response> { return didNotFinishAdminLoginRoute(db, request, (await params).raceId); }
export async function DELETE(request: Request, { params }: Context): Promise<Response> { return didNotFinishAdminLogoutRoute(db, request, (await params).raceId); }
