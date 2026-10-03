import { db } from "../../../../../../lib/db";
import { startListPublicationAdminPreviewRoute, authenticatedStartListPublicationRoute } from "../../../../../../lib/start-list-publication-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context) {
  return startListPublicationAdminPreviewRoute(db, request, (await params).raceId);
}
export async function POST(request: Request, { params }: Context) {
  return authenticatedStartListPublicationRoute(db, request, (await params).raceId);
}
