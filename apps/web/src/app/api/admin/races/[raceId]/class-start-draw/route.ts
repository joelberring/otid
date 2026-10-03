import { db } from "../../../../../../lib/db";
import { classStartDrawAdminClassesRoute, authenticatedClassStartDrawRoute } from "../../../../../../lib/class-start-draw-admin-route-handlers";
type Context = { params: Promise<{ raceId: string }> };
export async function GET(request: Request, { params }: Context) {
  return classStartDrawAdminClassesRoute(db, request, (await params).raceId);
}
export async function POST(request: Request, { params }: Context) {
  return authenticatedClassStartDrawRoute(db, request, (await params).raceId);
}
