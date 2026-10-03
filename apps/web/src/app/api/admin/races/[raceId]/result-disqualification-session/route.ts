import { db } from "../../../../../../lib/db";
import {
  resultDisqualificationAdminLoginRoute,
  resultDisqualificationAdminLogoutRoute,
  resultDisqualificationAdminSessionStatusRoute
} from "../../../../../../lib/result-disqualification-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationAdminLogoutRoute(db, request, (await params).raceId);
}
