import { db } from "../../../../../lib/db";
import { deviceBatchRoute } from "../../../../../lib/device-batch-route-handler";

export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return deviceBatchRoute(db, request, raceId);
}
