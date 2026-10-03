import { db } from "../../../../../../lib/db";
import {
  resultApprovalWithdrawalAdminLoginRoute,
  resultApprovalWithdrawalAdminLogoutRoute,
  resultApprovalWithdrawalAdminSessionStatusRoute
} from "../../../../../../lib/result-approval-withdrawal-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return resultApprovalWithdrawalAdminSessionStatusRoute(db, request, (await params).raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return resultApprovalWithdrawalAdminLoginRoute(db, request, (await params).raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return resultApprovalWithdrawalAdminLogoutRoute(db, request, (await params).raceId);
}
