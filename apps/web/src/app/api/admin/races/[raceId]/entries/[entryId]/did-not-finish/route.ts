import { db } from "../../../../../../../../lib/db";
import { authenticatedDidNotFinishRoute } from "../../../../../../../../lib/did-not-finish-admin-route-handlers";
export async function POST(request: Request, { params }: { params: Promise<{ raceId: string; entryId: string }> }): Promise<Response> { const { raceId, entryId } = await params; return authenticatedDidNotFinishRoute(db, request, raceId, entryId); }
