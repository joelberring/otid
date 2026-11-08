import { authorizationServerRoute } from "../../../lib/oauth-route-handlers";

/** ADR-0219 (K2): RFC 8414, inloggningsserverns metadata. */
export function GET(): Response {
  return authorizationServerRoute();
}
