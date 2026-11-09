import { db } from "../../../../lib/db";
import { myPlanTasksRoute } from "../../../../lib/club-planning-route-handlers";

/** ADR-0221: Mina uppgifter ur klubbarnas terminsplanering. */
export async function GET(request: Request): Promise<Response> {
  return myPlanTasksRoute(db, request, undefined);
}
