import { activateAccountInvitation } from "@o-tid/application";
import {
  accountInvitationActivationFailureSchema,
  accountInvitationActivationRequestSchema,
  accountInvitationActivationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  hasExpectedOrganizerOrigin,
  organizerJson,
  organizerSecurityPolicy,
  readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Activate = typeof activateAccountInvitation;

function unavailable(status = 400): Response {
  return organizerJson(accountInvitationActivationFailureSchema.parse({
    formatVersion: 1, error: "INVITATION_UNAVAILABLE"
  }), status);
}

/** Public, online-only activation: no session cookie and no account lookup. */
export async function accountInvitationActivationRoute(
  db: Database, request: Request, activate: Activate = activateAccountInvitation,
  environment: Environment = process.env
): Promise<Response> {
  let policy: ReturnType<typeof organizerSecurityPolicy>;
  try { policy = organizerSecurityPolicy(environment); }
  catch { return unavailable(500); }
  if (request.method !== "POST" || !hasExpectedOrganizerOrigin(request, policy)) return unavailable(403);
  let body: unknown;
  try { body = await readOrganizerJson(request); }
  catch { return unavailable(); }
  const parsed = accountInvitationActivationRequestSchema.safeParse(body);
  if (!parsed.success) return unavailable();
  try {
    const result = await activate(db, parsed.data);
    if (result.status !== "activated") return unavailable();
    return organizerJson(accountInvitationActivationResponseSchema.parse(result.response), 201);
  } catch { return unavailable(500); }
}
