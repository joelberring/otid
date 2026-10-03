import { db } from "../../../../../../lib/db";
import { outOfCompetitionAdminLoginRoute, outOfCompetitionAdminLogoutRoute, outOfCompetitionAdminSessionStatusRoute } from "../../../../../../lib/out-of-competition-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context): Promise<Response> { return outOfCompetitionAdminSessionStatusRoute(db, request, (await params).raceId); }
export async function POST(request: Request, { params }: Context): Promise<Response> { return outOfCompetitionAdminLoginRoute(db, request, (await params).raceId); }
export async function DELETE(request: Request, { params }: Context): Promise<Response> { return outOfCompetitionAdminLogoutRoute(db, request, (await params).raceId); }
