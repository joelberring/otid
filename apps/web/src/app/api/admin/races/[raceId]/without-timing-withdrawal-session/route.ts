import { db } from "../../../../../../lib/db";
import {
  withoutTimingWithdrawalAdminLoginRoute,
  withoutTimingWithdrawalAdminLogoutRoute,
  withoutTimingWithdrawalAdminSessionStatusRoute
} from "../../../../../../lib/without-timing-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return withoutTimingWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId);
}
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return withoutTimingWithdrawalAdminLoginRoute(db, request, (await params).raceId);
}
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return withoutTimingWithdrawalAdminLogoutRoute(db, request, (await params).raceId);
}
