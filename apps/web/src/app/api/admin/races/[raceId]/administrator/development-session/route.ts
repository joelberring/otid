import { db, pool } from "../../../../../../../lib/db";
import { developmentDemoSessionRoute } from "../../../../../../../lib/development-demo-access";

export async function POST(request: Request, context: { params: Promise<{ raceId: string }> }): Promise<Response> {
  const { raceId } = await context.params;
  return developmentDemoSessionRoute(db, request, raceId, {
    currentDatabaseName: async () => {
      const result = await pool.query<{ name: string }>("select current_database() as name");
      const name = result.rows[0]?.name;
      if (!name) throw new Error("database identity unavailable");
      return name;
    }
  });
}
