import { classVariantDistributionIdempotencyKeySchema, classVariantDistributionRequestSchema, classVariantDistributionResponseSchema,
  entryVariantIdempotencyKeySchema, entryVariantPreviewRequestSchema, entryVariantPreviewResponseSchema, entryVariantRequestSchema,
  entryVariantResponseSchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, readEntryClassAdminJson } from "./entry-class-admin-security";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/** Gafflingar (ADR-0169 beslut 2): byt löparens variant och "Fördela gafflingar". Ger undefined för andra åtgärder. */
export async function handleVariantRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "entry-variant-preview") {
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryVariantPreviewRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.entryVariantPreview(db, { ...proof, raceId, entryId: action.entryId, request: parsed.data });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = entryVariantPreviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.variantCode !== parsed.data.variantCode ||
        response.snapshotVersion !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "entry-variant") {
    const key = entryVariantIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryVariantRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.entryId !== action.entryId || key.data !== `entry-variant:${parsed.data.requestId}`) {
      return failure(400, "INVALID_REQUEST");
    }
    const result = await dependencies.entryVariant(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    // Resultatet ändras sedan beskedet visades: klienten hämtar nytt besked och frågar igen.
    if (result.status === "confirmation-required") return failure(409, "CONFLICT");
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryVariantResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  if (action.kind === "class-variant-distribution") {
    const key = classVariantDistributionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = classVariantDistributionRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.classId !== action.classId || key.data !== `variant-distribution:${parsed.data.requestId}`) {
      return failure(400, "INVALID_REQUEST");
    }
    const result = await dependencies.classVariantDistribution(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "distributed") return resultFailure(result.status);
    const response = classVariantDistributionResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
    return json(response);
  }
  return undefined;
}
