import { db } from "../../../../lib/db";
import { accountClubsRoute } from "../../../../lib/club-affiliation-route-handlers";

/** ADR-0209: Mina klubbar – läsa (GET), lägga till (POST) och ta bort (DELETE). */
export async function GET(request: Request): Promise<Response> { return accountClubsRoute(db, request); }
export async function POST(request: Request): Promise<Response> { return accountClubsRoute(db, request); }
export async function DELETE(request: Request): Promise<Response> { return accountClubsRoute(db, request); }
