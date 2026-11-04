import { db } from "../../../../lib/db";
import { logoutAllRoute } from "../../../../lib/google-link-route-handlers";
import { accountFailure, SecurityConfigurationError, securityPolicy } from "../../../../lib/security-policy";

export const dynamic = "force-dynamic";

/** ADR-0205 tillägg: "Logga ut från alla enheter" under Mitt konto. */
export async function POST(request: Request): Promise<Response> {
  let policy;
  try { policy = securityPolicy(); }
  catch (error) { if (error instanceof SecurityConfigurationError) return accountFailure(500, "INTERNAL_ERROR"); throw error; }
  return logoutAllRoute(db, request, policy);
}
