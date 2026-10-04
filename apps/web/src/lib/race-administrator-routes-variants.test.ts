import { describe, expect, it, vi } from "vitest";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: gafflingar", () => {
  it("byt variant: besked med POST, sparas bara med idempotensnyckel och samma begäran; ny bekräftelse ger 409", async () => {
    const preview = { formatVersion: 1 as const, raceId: id, entryId: other, snapshotVersion: 2, currentVariantCode: "AC", variantCode: "AD",
      readOutCount: 1, becomesOkCount: 1, becomesMispunchedCount: 0, unchangedCount: 0, notRecalculatedCount: 0, requiresConfirmation: true,
      changes: [{ entryId: other, displayName: "Ada Ek", className: "H21", before: "MP" as const, after: "OK" as const }] };
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2, expectedEntryVersion: 1, entryId: other,
      variantCode: "AD", confirmResultChanges: true };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other, request: body,
      previousVariantCode: "AC", entryVersionAfter: 2, snapshotVersionBefore: 2, snapshotVersionAfter: 3,
      recalculated: [{ entryId: other, resultRevisionId: id, revision: 2 }], changedAt: "2026-10-04T12:00:00.000Z" };
    const entryVariantPreview = vi.fn<typeof import("@o-tid/application").previewEntryVariantAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: preview });
    const entryVariant = vi.fn<typeof import("@o-tid/application").changeEntryVariantAsAdministrator>()
      .mockResolvedValue({ status: "changed", response: receipt });
    const services = { ...dependencies(), entryVariantPreview, entryVariant };
    const shown = await raceAdministratorRoute(db, request("POST", JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: 2,
      expectedEntryVersion: 1, variantCode: "AD" })), id, { kind: "entry-variant-preview", entryId: other }, services, environment);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual(preview);
    const action = { kind: "entry-variant" as const, entryId: other };
    const saved = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `entry-variant:${id}` }),
      id, action, services, environment);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(receipt);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `entry-variant:${other}` }),
      id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `entry-variant:${id}` }),
      id, { kind: "entry-variant", entryId: id }, services, environment)).status).toBe(400);
    entryVariant.mockResolvedValueOnce({ status: "confirmation-required", preview });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `entry-variant:${id}` }),
      id, action, services, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
  });

  it("fördela gafflingar: kräver idempotensnyckel som binder begäran och klass", async () => {
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2, classId: other };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, classId: other, request: body,
      assignedCount: 2, recalculatedCount: 0, snapshotVersionBefore: 2, snapshotVersionAfter: 3, distributedAt: "2026-10-04T12:00:00.000Z" };
    const classVariantDistribution = vi.fn<typeof import("@o-tid/application").distributeClassVariantsAsAdministrator>()
      .mockResolvedValue({ status: "distributed", response: receipt });
    const services = { ...dependencies(), classVariantDistribution };
    const action = { kind: "class-variant-distribution" as const, classId: other };
    const saved = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `variant-distribution:${id}` }),
      id, action, services, environment);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(receipt);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body)), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `variant-distribution:${id}`,
      origin: "https://evil.example" }), id, action, services, environment)).status).toBe(403);
    classVariantDistribution.mockResolvedValueOnce({ status: "conflict" });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `variant-distribution:${id}` }),
      id, action, services, environment)).status).toBe(409);
  });
});
