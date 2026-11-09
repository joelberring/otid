import { db } from "../../../../../lib/db";
import { myPlanTasksRoute } from "../../../../../lib/club-planning-route-handlers";

type Context = { params: Promise<{ taskId: string }> };

/** ADR-0221: uppgiften klar eller inte (den som har den, eller en ledare i klubben). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { taskId } = await context.params;
  return myPlanTasksRoute(db, request, taskId);
}
