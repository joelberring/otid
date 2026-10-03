import { db } from "../../../../../lib/db";
import { routeUploadTransferRoute } from "../../../../../lib/route-upload-route-handlers";

export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await context.params;
  return routeUploadTransferRoute(db, request, uploadId);
}
