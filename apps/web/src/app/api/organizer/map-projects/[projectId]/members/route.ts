import { db } from "../../../../../../lib/db";
import { mapProjectMembersRoute } from "../../../../../../lib/map-project-route-handlers";

type Context = { params: Promise<{ projectId: string }> };

/** ADR-0219: bjud in (POST), byt roll (PUT), ta bort medlem eller inbjudan (DELETE). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectMembersRoute(db, request, projectId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectMembersRoute(db, request, projectId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { projectId } = await context.params;
  return mapProjectMembersRoute(db, request, projectId);
}
