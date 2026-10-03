import { redeemAccountPasswordRecovery } from "@o-tid/application";
import {
  accountPasswordRecoveryRedeemFailureSchema,
  accountPasswordRecoveryRedeemRequestSchema,
  accountPasswordRecoveryRedeemResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  hasExpectedOrganizerOrigin,
  organizerJson,
  organizerSecurityPolicy,
  readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Redeem = typeof redeemAccountPasswordRecovery;

function unavailable(status = 400): Response {
  return organizerJson(accountPasswordRecoveryRedeemFailureSchema.parse({
    formatVersion: 1, error: "RECOVERY_UNAVAILABLE"
  }), status);
}

/** Public online redemption only; neither account status nor session is projected. */
export async function accountPasswordRecoveryRoute(
  db: Database, request: Request, redeem: Redeem = redeemAccountPasswordRecovery,
  environment: Environment = process.env
): Promise<Response> {
  let policy: ReturnType<typeof organizerSecurityPolicy>;
  try { policy = organizerSecurityPolicy(environment); }
  catch { return unavailable(500); }
  if (request.method !== "POST" || !hasExpectedOrganizerOrigin(request, policy)) return unavailable(403);
  let body: unknown;
  try { body = await readOrganizerJson(request); }
  catch { return unavailable(); }
  const parsed = accountPasswordRecoveryRedeemRequestSchema.safeParse(body);
  if (!parsed.success) return unavailable();
  try {
    const result = await redeem(db, parsed.data);
    if (result.status !== "recovered") return unavailable();
    const response = accountPasswordRecoveryRedeemResponseSchema.parse(result.response);
    if (response.loginName !== parsed.data.loginName) return unavailable(500);
    return organizerJson(response, 201);
  } catch { return unavailable(500); }
}
