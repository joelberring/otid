import { db } from "../../../../../../lib/db";
import {
  classStartDrawAdminLoginRoute,
  classStartDrawAdminLogoutRoute,
  classStartDrawAdminSessionStatusRoute
} from "../../../../../../lib/class-start-draw-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return classStartDrawAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return classStartDrawAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return classStartDrawAdminLogoutRoute(db, request, raceId);
}
