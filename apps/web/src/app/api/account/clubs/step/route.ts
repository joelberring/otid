import { db } from "../../../../../lib/db";
import { accountClubStepRoute } from "../../../../../lib/club-affiliation-route-handlers";

/** ADR-0209: steget efter registreringen ("Vilken klubb tillhör du?"). */
export async function POST(request: Request): Promise<Response> { return accountClubStepRoute(db, request); }
