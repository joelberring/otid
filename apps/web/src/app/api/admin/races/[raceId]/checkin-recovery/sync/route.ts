import { db } from "../../../../../../../lib/db";
import { checkinRecoverySyncRoute } from "../../../../../../../lib/checkin-recovery-route-handlers";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }): Promise<Response> {
  return checkinRecoverySyncRoute(db, request, (await params).raceId);
}
