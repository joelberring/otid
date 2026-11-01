import { db } from "../../../../../../lib/db";
import { raceMapAgreementAcknowledgeRoute, raceMapAgreementReadRoute } from "../../../../../../lib/training-group-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

/** Steg 68: kartans avtal på tävlingen och "Visa kartan publikt ändå". */
export async function GET(request: Request, context: Context): Promise<Response> {
  return raceMapAgreementReadRoute(db, request, (await context.params).raceId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  return raceMapAgreementAcknowledgeRoute(db, request, (await context.params).raceId);
}
