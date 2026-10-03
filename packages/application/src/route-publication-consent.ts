import { and, desc, eq, sql } from "drizzle-orm";
import {
  routePublicationConsentIdempotencyKeySchema, routePublicationConsentRequestSchema,
  routePublicationConsentResponseSchema, routePublicationConsentStateResponseSchema,
  type RoutePublicationConsentResponse, type RoutePublicationConsentStateResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockEntryForRevision } from "./concurrency";
import { authenticateRouteUploadSessionForMutation, authenticateRouteUploadSessionForRead, type RouteUploadSessionRequestAuthentication } from "./route-upload-session";

type Authentication = RouteUploadSessionRequestAuthentication;
type StateOutcome = { status: "ok"; response: RoutePublicationConsentStateResponse } | { status: "unauthorized" | "forbidden" };
type DecisionOutcome = { status: "stored"; response: RoutePublicationConsentResponse } | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" | "conflict" };

function consent(decision: string): "PRIVATE" | "READY_FOR_FUTURE_PUBLICATION" { return decision === "GRANT" ? "READY_FOR_FUTURE_PUBLICATION" : "PRIVATE"; }
function state(manifest: { uploadId: string } | undefined, latest: { revision: number; decision: string; decidedAt: Date } | undefined): RoutePublicationConsentStateResponse {
  return manifest ? routePublicationConsentStateResponseSchema.parse({ formatVersion: 1, status: "stored", consent: latest ? consent(latest.decision) : "PRIVATE", revision: latest?.revision ?? 0, decidedAt: latest?.decidedAt.toISOString() ?? null })
    : routePublicationConsentStateResponseSchema.parse({ formatVersion: 1, status: "not-uploaded" });
}

async function current(tx: Parameters<Database["transaction"]>[0] extends (argument: infer T) => unknown ? T : never, grantId: string, raceId: string, entryId: string) {
  const [manifest] = await tx.select({ uploadId: schema.routeObjectManifests.uploadId, sha256: schema.routeObjectManifests.sha256 })
    .from(schema.routeObjectManifests).where(and(eq(schema.routeObjectManifests.grantId, grantId), eq(schema.routeObjectManifests.raceId, raceId), eq(schema.routeObjectManifests.entryId, entryId))).limit(1);
  if (!manifest) return { manifest: undefined, latest: undefined };
  const [latest] = await tx.select({ revision: schema.routePublicationConsents.revision, decision: schema.routePublicationConsents.decision, decidedAt: schema.routePublicationConsents.decidedAt })
    .from(schema.routePublicationConsents).where(eq(schema.routePublicationConsents.manifestId, manifest.uploadId)).orderBy(desc(schema.routePublicationConsents.revision)).limit(1);
  return { manifest, latest };
}

/** Read-only participant status; an absent decision remains private by default. */
export async function readRoutePublicationConsentAsParticipant(db: Database, input: Authentication, now = new Date()): Promise<StateOutcome> {
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForRead(tx, { ...input, requireCsrf: false }, now);
    if (auth.status !== "authenticated") return auth;
    const resolved = await current(tx, auth.principal.grantId, auth.principal.raceId, auth.principal.entryId);
    return { status: "ok", response: state(resolved.manifest, resolved.latest) };
  });
}

/** Appends a participant-owned consent decision for exactly the server-resolved route manifest. */
export async function decideRoutePublicationConsentAsParticipant(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown }, now = new Date()): Promise<DecisionOutcome> {
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = routePublicationConsentIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = routePublicationConsentRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
    await lockEntryForRevision(tx, auth.principal.raceId, auth.principal.entryId);
    const requestId = key.data.slice("route-publication-consent:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const resolved = await current(tx, auth.principal.grantId, auth.principal.raceId, auth.principal.entryId);
    if (!resolved.manifest) return { status: "not-found" };
    const [existing] = await tx.select().from(schema.routePublicationConsents).where(eq(schema.routePublicationConsents.requestId, requestId));
    if (existing) {
      if (existing.grantId !== auth.principal.grantId || existing.raceId !== auth.principal.raceId || existing.entryId !== auth.principal.entryId ||
        existing.manifestId !== resolved.manifest.uploadId || existing.sourceHash !== resolved.manifest.sha256 || existing.decision !== request.data.decision) return { status: "conflict" };
      return { status: "stored", response: routePublicationConsentResponseSchema.parse({ formatVersion: 1, status: "stored", consent: consent(existing.decision), revision: existing.revision, decidedAt: existing.decidedAt.toISOString(), replayed: true }) };
    }
    const revision = (resolved.latest?.revision ?? 0) + 1;
    const [saved] = await tx.insert(schema.routePublicationConsents).values({ requestId, grantId: auth.principal.grantId, raceId: auth.principal.raceId,
      entryId: auth.principal.entryId, manifestId: resolved.manifest.uploadId, sourceHash: resolved.manifest.sha256, revision, decision: request.data.decision, decidedAt: now }).returning();
    if (!saved) throw new Error("ROUTE_PUBLICATION_CONSENT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: saved.raceId, entityType: "route_publication_consent", entityId: saved.id,
      action: saved.decision === "GRANT" ? "ROUTE_PUBLICATION_CONSENT_GRANTED" : "ROUTE_PUBLICATION_CONSENT_WITHDRAWN", requestId,
      after: { grantId: saved.grantId, entryId: saved.entryId, manifestId: saved.manifestId, sourceHash: saved.sourceHash, revision: saved.revision } });
    return { status: "stored", response: routePublicationConsentResponseSchema.parse({ formatVersion: 1, status: "stored", consent: consent(saved.decision), revision: saved.revision, decidedAt: saved.decidedAt.toISOString(), replayed: false }) };
  });
}
