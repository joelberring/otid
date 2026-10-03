import { db } from "../../../../lib/db";
import { stationPairingRedemptionResponse } from "../../../../lib/station-pairing-response";

export async function POST(request: Request): Promise<Response> {
  return stationPairingRedemptionResponse(db, request);
}
