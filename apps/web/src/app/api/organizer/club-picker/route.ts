import { db } from "../../../../lib/db";
import { clubPickerRoute } from "../../../../lib/club-affiliation-route-handlers";

/** ADR-0209: "Från klubben" – väljaren (GET) och inbjudan (POST). */
export async function GET(request: Request): Promise<Response> { return clubPickerRoute(db, request); }
export async function POST(request: Request): Promise<Response> { return clubPickerRoute(db, request); }
