import { db } from "../../../../lib/db";
import { redeemRouteUploadLinkRoute } from "../../../../lib/route-upload-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ grantId: string; secret: string }> }) {
  const { grantId, secret } = await context.params;
  return redeemRouteUploadLinkRoute(db, request, grantId, secret);
}
