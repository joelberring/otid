import { db } from "../../../../lib/db";
import { eventorImportRoute } from "../../../../lib/eventor-import-route";
export const runtime = "nodejs";
export async function GET(request: Request) { return eventorImportRoute(db, request, "list"); }
export async function POST(request: Request) { return eventorImportRoute(db, request, "commit"); }
