import { db } from "../../../../../../lib/db";
import {
  resultDisqualificationWithdrawalAdminLoginRoute,
  resultDisqualificationWithdrawalAdminLogoutRoute,
  resultDisqualificationWithdrawalAdminSessionStatusRoute
} from "../../../../../../lib/result-disqualification-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationWithdrawalAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return resultDisqualificationWithdrawalAdminLogoutRoute(db, request, (await params).raceId);
}
