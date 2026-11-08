import { publicDb } from "../../../lib/db";
import { mcpRoute } from "../../../lib/oauth-route-handlers";

/**
 * ADR-0219 (K2): MCP för AI-kopplingen. Publikens databaspool (korta tidsgränser): tävlingens pool används aldrig av AI.
 * Det tunga görs av utskriftsarbetaren.
 */
export async function POST(request: Request): Promise<Response> {
  return mcpRoute(publicDb, request);
}

export async function GET(request: Request): Promise<Response> {
  return mcpRoute(publicDb, request);
}

export async function DELETE(request: Request): Promise<Response> {
  return mcpRoute(publicDb, request);
}
