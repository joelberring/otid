import { describe, expect, it, vi } from "vitest";
import { authenticatedWithoutTimingRoute } from "./without-timing-admin-route-handlers";
import type { authenticatePairingAdminSession, decideWithoutTimingAsAdmin } from "@o-tid/application";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const targetId = "10000000-0000-4000-8000-000000000006";
const resultId = "10000000-0000-4000-8000-000000000007";
const csrf = "c".repeat(43);
const environment: { NODE_ENV: "production"; O_TID_PUBLIC_ORIGIN: string } = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" };
const db = {} as never;
const body = { formatVersion: 1 as const, expectedEntryVersion: 2, expectedClassId: classId, expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 4, expectedResultRevision: { id: targetId, revision: 3, status: "OK" as const, reason: "COMPLETE" as const }, policyVersion: "without-timing-v1" as const };

function authenticated() { return { status: "authenticated" as const, principal: { raceId, capability: "DECIDE_WITHOUT_TIMING" as const, accessCredentialId: "10000000-0000-4000-8000-000000000008", expiresAt: "2026-09-01T12:00:00.000Z" } }; }

describe("TASK 006M utan-tidtagning-routes", () => {
  it("avvisar origin och idempotensnyckel före bodyläsning", async () => {
    let reads = 0;
    const unread = { headers: new Headers({ origin: "https://evil.example" }), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    expect((await authenticatedWithoutTimingRoute(db, unread, raceId, entryId, vi.fn() as unknown as typeof authenticatePairingAdminSession, vi.fn() as unknown as typeof decideWithoutTimingAsAdmin, environment)).status).toBe(403);
    expect(reads).toBe(0);
    const badKey = { headers: new Headers({ origin: environment.O_TID_PUBLIC_ORIGIN, cookie: `__Host-otid-without-timing-admin-session=x; __Host-otid-without-timing-admin-csrf=${csrf}`, "x-otid-csrf": csrf, "idempotency-key": "bad" }), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    expect((await authenticatedWithoutTimingRoute(db, badKey, raceId, entryId, vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession, vi.fn() as unknown as typeof decideWithoutTimingAsAdmin, environment)).status).toBe(400);
    expect(reads).toBe(0);
  });
  it("vidarebefordrar exakt NT-intent", async () => {
    const decide = vi.fn(async () => ({ status: "without-timing" as const, response: { formatVersion: 1 as const, replayed: false, requestId, raceId, entryId, withoutTimingDecisionId: "10000000-0000-4000-8000-000000000009", targetResultRevisionId: targetId, targetResultRevision: 3, resultRevisionId: resultId, revision: 4, cause: "MANUAL_WITHOUT_TIMING" as const, status: "NT" as const, reason: "WITHOUT_TIMING" as const, policyVersion: "without-timing-v1" as const, snapshotVersion: 4, courseVersionId, decidedAt: "2026-09-01T11:00:00.000Z" } })) as unknown as typeof decideWithoutTimingAsAdmin;
    const response = await authenticatedWithoutTimingRoute(db, new Request("https://otid.example", { method: "POST", headers: { origin: environment.O_TID_PUBLIC_ORIGIN, cookie: `__Host-otid-without-timing-admin-session=x; __Host-otid-without-timing-admin-csrf=${csrf}`, "x-otid-csrf": csrf, "content-type": "application/json", "idempotency-key": `without-timing:${requestId}` }, body: JSON.stringify(body) }), raceId, entryId, vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession, decide, environment);
    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, entryId, idempotencyKey: `without-timing:${requestId}`, request: body }));
  });
});
