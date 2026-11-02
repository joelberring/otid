import { db } from "../../../../../../lib/db";
import { clubMembersRoute } from "../../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194: bjud in (POST), ändra roll (PUT), ta bort medlem eller inbjudan (DELETE). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMembersRoute(db, request, clubId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMembersRoute(db, request, clubId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubMembersRoute(db, request, clubId);
}
