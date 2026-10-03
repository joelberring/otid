import { db } from "../../../../../../lib/db";
import { courseControlGeometryStateRoute, createCourseControlGeometryRoute } from "../../../../../../lib/course-control-geometry-route-handlers";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) { const { raceId } = await context.params; return courseControlGeometryStateRoute(db, request, raceId); }
export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }) { const { raceId } = await context.params; return createCourseControlGeometryRoute(db, request, raceId); }
