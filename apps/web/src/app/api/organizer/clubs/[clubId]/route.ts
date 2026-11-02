import { db } from "../../../../../lib/db";
import { clubReadRoute } from "../../../../../lib/club-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0194: klubbens vy (medlemmar, inbjudningar, användning, importnycklar). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubReadRoute(db, request, clubId);
}
