import { db } from "../../../../../../lib/db";
import {
  readoutResultHistoryAdminLoginRoute,
  readoutResultHistoryAdminLogoutRoute,
  readoutResultHistoryAdminSessionStatusRoute
} from "../../../../../../lib/readout-result-history-admin-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return readoutResultHistoryAdminSessionStatusRoute(db, request, (await params).raceId);
}
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return readoutResultHistoryAdminLoginRoute(db, request, (await params).raceId);
}
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return readoutResultHistoryAdminLogoutRoute(db, request, (await params).raceId);
}
