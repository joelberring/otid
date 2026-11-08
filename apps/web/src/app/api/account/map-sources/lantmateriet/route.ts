import { db } from "../../../../../lib/db";
import { mapSourceCredentialRoute } from "../../../../../lib/map-project-source-route-handlers";

/** ADR-0219 (K4c): kontots egna uppgifter till Lantmäteriet (GET vad som är sparat, PUT spara, DELETE ta bort). */
export async function GET(request: Request): Promise<Response> {
  return mapSourceCredentialRoute(db, request);
}

export async function PUT(request: Request): Promise<Response> {
  return mapSourceCredentialRoute(db, request);
}

export async function DELETE(request: Request): Promise<Response> {
  return mapSourceCredentialRoute(db, request);
}
