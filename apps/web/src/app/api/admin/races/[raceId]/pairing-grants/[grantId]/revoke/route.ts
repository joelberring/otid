import { db } from "../../../../../../../../lib/db";
import { pairingAdminGrantRevokeRoute } from "../../../../../../../../lib/pairing-admin-route-handlers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string; grantId: string }> }
): Promise<Response> {
  const { raceId, grantId } = await params;
  return pairingAdminGrantRevokeRoute(db, request, raceId, grantId);
}
