import { db } from "../../../../lib/db";
import { routeUploadReservationRoute } from "../../../../lib/route-upload-route-handlers";

export const runtime = "nodejs";
export async function POST(request: Request) { return routeUploadReservationRoute(db, request); }
