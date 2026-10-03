import { db } from "../../../../../../../../../lib/db";
import { raceAdministratorRoute } from "../../../../../../../../../lib/race-administrator-route-handlers";

export async function GET(request: Request, context: { params: Promise<{ raceId: string; classId: string }> }) {
  const { raceId, classId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "manual-course-version-link", classId });
}

export async function POST(request: Request, context: { params: Promise<{ raceId: string; classId: string }> }) {
  const { raceId, classId } = await context.params;
  return raceAdministratorRoute(db, request, raceId, { kind: "manual-course-version-link", classId });
}
