import { db } from "../../../../../../../lib/db";
import { iofResultListExportDownloadRoute } from "../../../../../../../lib/iof-result-list-export-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return iofResultListExportDownloadRoute(db, request, (await params).raceId);
}
