import { db } from "../../../../lib/db";
import { routeUploadStatusRoute } from "../../../../lib/route-upload-route-handlers";

export const runtime = "nodejs";
export async function GET(request: Request) { return routeUploadStatusRoute(db, request); }
