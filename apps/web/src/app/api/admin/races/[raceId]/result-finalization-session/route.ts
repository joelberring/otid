import { db } from "../../../../../../lib/db";
import {
  resultFinalizationAdminLoginRoute,
  resultFinalizationAdminLogoutRoute,
  resultFinalizationAdminSessionStatusRoute
} from "../../../../../../lib/result-finalization-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultFinalizationAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultFinalizationAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return resultFinalizationAdminLogoutRoute(db, request, raceId);
}
