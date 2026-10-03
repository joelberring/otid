import { db } from "../../../../../../lib/db";
import {
  outOfCompetitionWithdrawalAdminLoginRoute,
  outOfCompetitionWithdrawalAdminLogoutRoute,
  outOfCompetitionWithdrawalAdminSessionStatusRoute
} from "../../../../../../lib/out-of-competition-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return outOfCompetitionWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return outOfCompetitionWithdrawalAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return outOfCompetitionWithdrawalAdminLogoutRoute(db, request, (await params).raceId);
}
