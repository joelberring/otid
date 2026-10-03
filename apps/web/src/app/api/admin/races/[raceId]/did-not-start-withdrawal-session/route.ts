import { db } from "../../../../../../lib/db";
import {
  didNotStartWithdrawalAdminLoginRoute,
  didNotStartWithdrawalAdminLogoutRoute,
  didNotStartWithdrawalAdminSessionStatusRoute
} from "../../../../../../lib/did-not-start-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return didNotStartWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return didNotStartWithdrawalAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return didNotStartWithdrawalAdminLogoutRoute(db, request, (await params).raceId);
}
