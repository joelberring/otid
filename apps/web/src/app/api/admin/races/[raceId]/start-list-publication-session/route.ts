import { db } from "../../../../../../lib/db";
import {
  startListPublicationAdminLoginRoute,
  startListPublicationAdminLogoutRoute,
  startListPublicationAdminSessionStatusRoute
} from "../../../../../../lib/start-list-publication-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListPublicationAdminSessionStatusRoute(db, request, raceId);
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListPublicationAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return startListPublicationAdminLogoutRoute(db, request, raceId);
}
