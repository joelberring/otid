import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  loginPairingAdmin,
  withdrawResultApprovalAsAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedResultApprovalWithdrawalRoute,
  resultApprovalWithdrawalAdminLoginRoute
} from "./result-approval-withdrawal-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const credentialId = "10000000-0000-4000-8000-000000000006";
const sessionId = "10000000-0000-4000-8000-000000000007";
const decisionId = "10000000-0000-4000-8000-000000000008";
const targetId = "10000000-0000-4000-8000-000000000009";
const dsqId = "10000000-0000-4000-8000-00000000000a";
const absoluteId = "10000000-0000-4000-8000-00000000000b";
const sourceId = "10000000-0000-4000-8000-00000000000c";
const withdrawalId = "10000000-0000-4000-8000-00000000000d";
const restorationId = "10000000-0000-4000-8000-00000000000e";
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const body = {
  formatVersion: 1 as const, expectedEntryVersion: 2, expectedClassId: classId,
  expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 5,
  expectedResultApprovalDecisionId: decisionId,
  expectedTargetResultRevision: {
    id: targetId, revision: 1, status: "MP" as const, reason: "MISSING_CONTROL" as const
  },
  expectedApprovedResultRevision: { id: dsqId, revision: 2 },
  expectedAbsoluteResultRevision: { id: absoluteId, revision: 3 },
  expectedRestorationSourceResultRevision: {
    id: sourceId, revision: 3, status: "MP" as const, reason: "MISSING_CONTROL" as const
  },
  policyVersion: "manual-result-approval-withdrawal-v1" as const
};

function request(bodyText?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method: "POST", headers };
  if (bodyText !== undefined) init.body = bodyText;
  return new Request(`https://otid.example/api/admin/races/${raceId}/entries/${entryId}/result-approval-withdrawal`, init);
}

function protectedHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://otid.example",
    cookie: `__Host-otid-result-approval-withdrawal-admin-session=${sessionToken}; __Host-otid-result-approval-withdrawal-admin-csrf=${csrfToken}`,
    "x-otid-csrf": csrfToken,
    ...extra
  };
}

function authenticated() {
  return { status: "authenticated" as const, principal: {
    accessCredentialId: credentialId, raceId, capability: "WITHDRAW_RESULT_APPROVAL" as const,
    sessionId, expiresAt: "2026-08-31T13:00:00.000Z"
  } };
}

describe("TASK 006G återtagande av resultatgodkännandesroutes", () => {
  it("binder login endast till WITHDRAW_RESULT_APPROVAL och egen cookie", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "WITHDRAW_RESULT_APPROVAL" as const,
        expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken, csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await resultApprovalWithdrawalAdminLoginRoute(db, request(JSON.stringify({
      formatVersion: 1,
      accessCredential: `otid_org_result_approval_withdrawal_v1.${credentialId}.${"a".repeat(43)}`
    }), { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId, expectedCapability: "WITHDRAW_RESULT_APPROVAL"
    });
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n"))
      .toContain("__Host-otid-result-approval-withdrawal-admin-session");
  });

  it("validerar auth och same-id-key före body och skickar exakt restaureringsintent", async () => {
    let reads = 0;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const unread = {
      headers: new Headers(protectedHeaders({ "content-type": "application/json", "idempotency-key": "bad" })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    expect((await authenticatedResultApprovalWithdrawalRoute(
      db, unread, raceId, entryId, authenticate,
      vi.fn() as unknown as typeof withdrawResultApprovalAsAdmin, environment
    )).status).toBe(400);
    expect(reads).toBe(0);

    const withdraw = vi.fn(async (_db: Database, input: Parameters<typeof withdrawResultApprovalAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId, entryId,
        idempotencyKey: `manual-result-approval-withdrawal:${requestId}`, request: body });
      return { status: "withdrawn" as const, response: {
        formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
        resultApprovalWithdrawalId: withdrawalId,
        resultApprovalDecisionId: decisionId,
        approvedResultRevisionId: dsqId,
        restorationSourceResultRevisionId: sourceId,
        restorationResultRevisionId: restorationId,
        revision: 4, cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" as const,
        status: "MP" as const, reason: "MISSING_CONTROL" as const,
        policyVersion: "manual-result-approval-withdrawal-v1" as const,
        snapshotVersion: 5, courseVersionId, withdrawnAt: "2026-08-31T11:00:00.000Z"
      } };
    }) as unknown as typeof withdrawResultApprovalAsAdmin;
    const response = await authenticatedResultApprovalWithdrawalRoute(
      db,
      request(JSON.stringify(body), protectedHeaders({
        "content-type": "application/json",
        "idempotency-key": `manual-result-approval-withdrawal:${requestId}`
      })),
      raceId, entryId, authenticate, withdraw, environment
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId, restorationResultRevisionId: restorationId });
  });
});
