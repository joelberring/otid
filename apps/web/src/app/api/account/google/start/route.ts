import { googleStartRoute } from "../../../../../lib/google-route-handlers";

export const dynamic = "force-dynamic";

/** ADR-0205: "Logga in med Google" – till Googles inloggning med state, nonce och PKCE. */
export function GET(request: Request): Response {
  return googleStartRoute(request);
}
