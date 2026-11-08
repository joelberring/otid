import { db } from "../../../../../../../lib/db";
import { mapProjectNoteRoute } from "../../../../../../../lib/map-project-recon-route-handlers";

type Context = { params: Promise<{ projectId: string; noteId: string }> };

/** ADR-0219 (K3): klar eller öppen igen (PUT) och ta bort (DELETE): den som skrev notisen eller ägarna. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, noteId } = await context.params;
  return mapProjectNoteRoute(db, request, projectId, noteId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId, noteId } = await context.params;
  return mapProjectNoteRoute(db, request, projectId, noteId);
}
