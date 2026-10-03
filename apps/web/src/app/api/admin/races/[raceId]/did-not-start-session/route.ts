import { db } from "../../../../../../lib/db";
import {
  didNotStartAdminLoginRoute,
  didNotStartAdminLogoutRoute,
  didNotStartAdminSessionStatusRoute
} from "../../../../../../lib/did-not-start-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return didNotStartAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return didNotStartAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return didNotStartAdminLogoutRoute(db, request, (await params).raceId);
}
