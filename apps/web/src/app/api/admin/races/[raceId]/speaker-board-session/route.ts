import { speakerBoardLoginRoute, speakerBoardLogoutRoute, speakerBoardSessionStatusRoute } from "../../../../../../lib/speaker-board-route-handlers";
import { speakerBoardFailure } from "../../../../../../lib/speaker-board-security";
type Context = { params: Promise<{ raceId: string }> };
const RACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function databaseFor(params: Context["params"]): Promise<{ raceId: string; db: typeof import("../../../../../../lib/db").db } | Response> {
  const { raceId } = await params;
  if (!RACE_ID.test(raceId)) return speakerBoardFailure(404, "NOT_FOUND");
  try { const { db } = await import("../../../../../../lib/db"); return { raceId, db }; }
  catch { return speakerBoardFailure(500, "INTERNAL_ERROR"); }
}
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const resolved = await databaseFor(params); return resolved instanceof Response ? resolved : speakerBoardSessionStatusRoute(resolved.db, request, resolved.raceId);
}
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const resolved = await databaseFor(params); return resolved instanceof Response ? resolved : speakerBoardLoginRoute(resolved.db, request, resolved.raceId);
}
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const resolved = await databaseFor(params); return resolved instanceof Response ? resolved : speakerBoardLogoutRoute(resolved.db, request, resolved.raceId);
}
