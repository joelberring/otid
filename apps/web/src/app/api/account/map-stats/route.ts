import { db } from "../../../../lib/db";
import { myMapStatsRoute } from "../../../../lib/map-project-recon-route-handlers";

/** ADR-0219 (K3b): den egna kartstatistiken (GET, `?season=2026`) och "Visa mig i topplistorna" (PUT). */
export async function GET(request: Request): Promise<Response> {
  return myMapStatsRoute(db, request);
}

export async function PUT(request: Request): Promise<Response> {
  return myMapStatsRoute(db, request);
}
