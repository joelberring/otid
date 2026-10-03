import { db } from "../../../../../../lib/db";
import {
  pairingAdminLoginRoute,
  pairingAdminLogoutRoute
} from "../../../../../../lib/pairing-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return pairingAdminLoginRoute(db, request, raceId);
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  return pairingAdminLogoutRoute(db, request, raceId);
}
