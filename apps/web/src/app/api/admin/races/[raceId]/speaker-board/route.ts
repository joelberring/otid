import { speakerBoardDataRoute } from "../../../../../../lib/speaker-board-route-handlers";
import { speakerBoardFailure } from "../../../../../../lib/speaker-board-security";
type Context = { params: Promise<{ raceId: string }> };
const RACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { raceId } = await params;
  if (!RACE_ID.test(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  try {
    const { db } = await import("../../../../../../lib/db");
    return speakerBoardDataRoute(db, request, raceId);
  } catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
