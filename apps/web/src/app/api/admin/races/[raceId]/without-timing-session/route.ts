import { db } from "../../../../../../lib/db";
import { withoutTimingAdminLoginRoute, withoutTimingAdminLogoutRoute, withoutTimingAdminSessionStatusRoute } from "../../../../../../lib/without-timing-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> { return withoutTimingAdminSessionStatusRoute(db, request, (await params).raceId); }
export async function POST(request: Request, { params }: Context): Promise<Response> { return withoutTimingAdminLoginRoute(db, request, (await params).raceId); }
export async function DELETE(request: Request, { params }: Context): Promise<Response> { return withoutTimingAdminLogoutRoute(db, request, (await params).raceId); }
