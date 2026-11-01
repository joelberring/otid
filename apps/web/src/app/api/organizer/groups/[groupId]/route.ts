import { db } from "../../../../../lib/db";
import { groupReadRoute, groupSettingsRoute } from "../../../../../lib/training-group-route-handlers";

type Context = { params: Promise<{ groupId: string }> };

/** Steg 68: ledarnas vy av gruppen (GET) och gruppens inställningar (PUT). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return groupReadRoute(db, request, (await context.params).groupId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  return groupSettingsRoute(db, request, (await context.params).groupId);
}
