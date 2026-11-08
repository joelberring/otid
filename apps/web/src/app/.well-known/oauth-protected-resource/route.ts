import { protectedResourceRoute } from "../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): RFC 9728, metadata för MCP-resursen. */
export function GET(): Response {
  return protectedResourceRoute();
}
