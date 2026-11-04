import { db } from "../../../../../lib/db";
import { googleMoveRoute } from "../../../../../lib/google-link-route-handlers";

export const dynamic = "force-dynamic";

/** ADR-0205 tillägg: flytten av Google-kopplingen från ett tomt dubblettkonto (läs, gör, avbryt). */
export async function GET(request: Request): Promise<Response> {
  return googleMoveRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return googleMoveRoute(db, request);
}

export async function DELETE(request: Request): Promise<Response> {
  return googleMoveRoute(db, request);
}
