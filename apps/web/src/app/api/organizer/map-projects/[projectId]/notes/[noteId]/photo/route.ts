import { db } from "../../../../../../../../lib/db";
import { mapProjectNotePhotoRoute } from "../../../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string; noteId: string }> };

/** ADR-0219 (K3): notisens foto (alla medlemmar). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { projectId, noteId } = await context.params;
  return mapProjectNotePhotoRoute(db, request, projectId, noteId);
}
