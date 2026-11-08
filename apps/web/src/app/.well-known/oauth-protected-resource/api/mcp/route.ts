import { protectedResourceRoute } from "../../../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): RFC 9728 med resursens sökväg (`/api/mcp`). */
export function GET(): Response {
  return protectedResourceRoute();
}
