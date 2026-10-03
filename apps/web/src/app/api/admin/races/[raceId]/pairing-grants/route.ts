import { db } from "../../../../../../lib/db";
import {
  pairingAdminGrantIssueRoute,
  pairingAdminGrantListRoute
} from "../../../../../../lib/pairing-admin-route-handlers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await params;
  return pairingAdminGrantListRoute(db, request, raceId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
): Promise<Response> {
  const { raceId } = await params;
  return pairingAdminGrantIssueRoute(db, request, raceId);
}

