import { db } from "../../../../../../lib/db";
import { eventorEntryImportCommitRoute } from "../../../../../../lib/eventor-entry-import-route";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return eventorEntryImportCommitRoute(db, request, raceId);
}
