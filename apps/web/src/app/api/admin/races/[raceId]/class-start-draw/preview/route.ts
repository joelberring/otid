import { db } from "../../../../../../../lib/db";
import { classStartDrawAdminPreviewRoute } from "../../../../../../../lib/class-start-draw-admin-route-handlers";
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  return classStartDrawAdminPreviewRoute(db, request, (await params).raceId);
}
