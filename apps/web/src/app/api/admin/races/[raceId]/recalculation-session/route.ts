import { db } from "../../../../../../lib/db";
import {
  resultRecalculationAdminLoginRoute,
  resultRecalculationAdminLogoutRoute,
  resultRecalculationAdminSessionStatusRoute
} from "../../../../../../lib/result-recalculation-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultRecalculationAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultRecalculationAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultRecalculationAdminLogoutRoute(db, request, raceId);
}
