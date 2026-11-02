import { db } from "../../../../../lib/db";
import { raceRestorePreviewRoute } from "../../../../../lib/race-restore-route-handlers";

/** ADR-0187: kontrollerar säkerhetskopian och visar vad den nya tävlingen får, utan att något sparas. */
export async function POST(request: Request): Promise<Response> {
  return raceRestorePreviewRoute(db, request);
}
