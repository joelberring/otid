import { db } from "../../../../../../lib/db";
import {
  iofResultListExportAdminLoginRoute,
  iofResultListExportAdminLogoutRoute,
  iofResultListExportAdminSessionStatusRoute
} from "../../../../../../lib/iof-result-list-export-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return iofResultListExportAdminSessionStatusRoute(db, request, (await params).raceId);
}
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return iofResultListExportAdminLoginRoute(db, request, (await params).raceId);
}
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return iofResultListExportAdminLogoutRoute(db, request, (await params).raceId);
}
