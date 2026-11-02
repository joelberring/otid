import { db } from "../../../../../../../lib/db";
import { clubCourseFileRoute } from "../../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string; courseFileId: string }> };

/** ADR-0194: banfilen orörd (GET) och banfilens karta (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId, courseFileId } = await context.params;
  return clubCourseFileRoute(db, request, clubId, courseFileId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId, courseFileId } = await context.params;
  return clubCourseFileRoute(db, request, clubId, courseFileId);
}
